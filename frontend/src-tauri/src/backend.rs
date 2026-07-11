use std::sync::Arc;
use anyhow::{Result, Context};
use tauri::{AppHandle, Emitter, Manager};
use tokio::time::{sleep, Duration};
use tauri_plugin_shell::{ShellExt, process::CommandChild, process::CommandEvent};
use tokio::process::Command as TokioCommand;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};

/// Append a line to %TEMP%\fixspotify_boot.log. The GUI subsystem discards
/// stdout/stderr, so this file is the only way to see how backend startup went.
fn boot_log(msg: &str) {
  use std::io::Write;
  let path = std::env::temp_dir().join("fixspotify_boot.log");
  if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
    let _ = writeln!(f, "{}", msg);
  }
}

pub struct PythonBackend {
  app_handle: AppHandle,
  // We keep a tokio child for the fallback process, and a CommandChild for the sidecar
  sidecar_process: Arc<tokio::sync::Mutex<Option<CommandChild>>>,
  fallback_process: Arc<tokio::sync::Mutex<Option<tokio::process::Child>>>,
  port: u16,
}

impl PythonBackend {
  pub fn new(app_handle: AppHandle) -> Result<Self> {
    let port = 8765;
    
    Ok(Self {
      app_handle,
      sidecar_process: Arc::new(tokio::sync::Mutex::new(None)),
      fallback_process: Arc::new(tokio::sync::Mutex::new(None)),
      port,
    })
  }
  
  pub async fn start(&self) -> Result<()> {
    let mut sidecar_guard = self.sidecar_process.lock().await;
    let mut fallback_guard = self.fallback_process.lock().await;
    
    if sidecar_guard.is_some() || fallback_guard.is_some() {
      return Ok(());
    }
    
    println!("Starting Python backend...");
    
    let sidecar_cmd = self.app_handle.shell().sidecar("backend");

    // The bundled ffmpeg + Deno (yt-dlp's JS runtime) ship as Tauri resources
    // under <resource_dir>/bin. Hand that path to the Python backend via an env
    // var; it prepends it to PATH so yt-dlp/ffmpeg/ffprobe are found in the EXE
    // (in dev they're already on the system PATH, so this is a no-op miss).
    let bin_dir = self
      .app_handle
      .path()
      .resource_dir()
      .ok()
      .map(|r| r.join("bin"))
      .filter(|p| p.exists());
    boot_log(&format!("start(): bin_dir={:?}", bin_dir));

    match sidecar_cmd {
      Ok(cmd) => {
         println!("Found sidecar configuration. Spawning...");
         boot_log("sidecar(\"backend\") resolved OK");
         let mut cmd = cmd.args(["--port", &self.port.to_string(), "--host", "127.0.0.1"]);
         if let Some(ref b) = bin_dir {
            cmd = cmd.env("FIX_SPOTIFY_BIN", b.to_string_lossy().to_string());
         }
         let spawned = cmd.spawn();
         let (mut rx, child) = match spawned {
            Ok(v) => { boot_log("sidecar spawned OK"); v }
            Err(e) => { boot_log(&format!("sidecar spawn FAILED: {}", e)); return Err(e.into()); }
         };
            
         let app_handle_clone = self.app_handle.clone();
         tokio::spawn(async move {
            while let Some(event) = rx.recv().await {
              match event {
                CommandEvent::Stdout(line) => {
                  let _ = app_handle_clone.emit("backend:log", String::from_utf8_lossy(&line).into_owned());
                }
                CommandEvent::Stderr(line) => {
                  let s = String::from_utf8_lossy(&line).into_owned();
                  boot_log(&format!("[backend stderr] {}", s));
                  let _ = app_handle_clone.emit("backend:error", s);
                }
                _ => {}
              }
            }
         });
         
         *sidecar_guard = Some(child);
      },
      Err(e) => {
         println!("Sidecar not found ({}), attempting local development fallback.", e);
         boot_log(&format!("sidecar NOT found ({}), trying python fallback", e));
         let mut cmd = TokioCommand::new("python");
         cmd.arg("../api/main.py")
            .arg("--port").arg(self.port.to_string())
            .arg("--host").arg("127.0.0.1")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
            
         let mut child = cmd.spawn().context("Failed to spawn Python backend via dev fallback")?;
         
         if let Some(stdout) = child.stdout.take() {
           let app_handle = self.app_handle.clone();
           tokio::spawn(async move {
             let mut lines = BufReader::new(stdout).lines();
             while let Ok(Some(line)) = lines.next_line().await {
               let _ = app_handle.emit("backend:log", line);
             }
           });
         }
         
         if let Some(stderr) = child.stderr.take() {
           let app_handle = self.app_handle.clone();
           tokio::spawn(async move {
             let mut lines = BufReader::new(stderr).lines();
             while let Ok(Some(line)) = lines.next_line().await {
               let _ = app_handle.emit("backend:error", line);
             }
           });
         }
         
         *fallback_guard = Some(child);
      }
    }
    
    let ready = self.wait_for_ready().await;
    boot_log(&format!("wait_for_ready -> {:?}", ready.as_ref().map(|_| "OK")));
    ready?;
    println!("Python backend started on port {}", self.port);
    Ok(())
  }
  
  async fn wait_for_ready(&self) -> Result<()> {
    let client = reqwest::Client::new();
    let url = format!("http://127.0.0.1:{}/health", self.port);
    
    for _ in 1..=30 {
      if let Ok(resp) = client.get(&url).send().await {
        if resp.status().is_success() {
          return Ok(());
        }
      }
      sleep(Duration::from_millis(500)).await;
    }
    
    anyhow::bail!("Backend failed to start within timeout")
  }
  
  pub fn is_running(&self) -> bool { true }
  
  pub fn port(&self) -> u16 { self.port }
  
  pub async fn stop(&self) -> Result<()> {
    let mut sidecar_guard = self.sidecar_process.lock().await;
    if let Some(child) = sidecar_guard.take() {
      let _ = child.kill();
    }
    
    let mut fallback_guard = self.fallback_process.lock().await;
    if let Some(mut child) = fallback_guard.take() {
      let _ = child.kill().await;
    }
    Ok(())
  }
}

impl Drop for PythonBackend {
  fn drop(&mut self) {
    if let Ok(mut guard) = self.sidecar_process.try_lock() {
      if let Some(child) = guard.take() {
        let _ = child.kill();
      }
    }
    if let Ok(mut guard) = self.fallback_process.try_lock() {
      if let Some(mut child) = guard.take() {
        let _ = child.start_kill();
      }
    }
  }
}