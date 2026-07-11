// Suppress the console window in release builds (Windows).
// Without this, Windows treats the exe as a console app → visible terminal.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]


mod backend;
mod commands;
mod download;

use backend::PythonBackend;
use commands::*;
use download::DownloadQueue;
use std::sync::{Arc, Mutex};
use tauri::{Manager, State, AppHandle};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct AppSettings {
  output_directory: Option<String>,
  max_bitrate: u32,
  preferred_source: Option<String>,
  theme: String,
  auto_start_downloads: bool,
}

impl Default for AppSettings {
  fn default() -> Self {
    Self {
      output_directory: None,
      max_bitrate: 256,
      preferred_source: None,
      theme: "dark".to_string(),
      auto_start_downloads: true,
    }
  }
}

struct AppState {
  backend: Arc<Mutex<Option<PythonBackend>>>,
  download_queue: Arc<Mutex<DownloadQueue>>,
  settings: Arc<Mutex<AppSettings>>,
}

#[tauri::command]
async fn greet(name: String) -> Result<String, String> {
  Ok(format!("Hello, {}! Welcome to Fix_Spotify", name))
}

#[tauri::command]
async fn get_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
  let settings = state.settings.lock().unwrap();
  Ok(settings.clone())
}

#[tauri::command]
async fn update_settings(
  state: State<'_, AppState>,
  settings: AppSettings,
) -> Result<(), String> {
  let mut current = state.settings.lock().unwrap();
  *current = settings;
  Ok(())
}

#[tauri::command]
async fn get_backend_status(state: State<'_, AppState>) -> Result<BackendStatus, String> {
  let backend = state.backend.lock().unwrap();
  Ok(BackendStatus {
    running: backend.as_ref().map(|b| b.is_running()).unwrap_or(false),
    port: backend.as_ref().map(|b| b.port()).unwrap_or(0),
  })
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct BackendStatus {
  running: bool,
  port: u16,
}

async fn start_python_backend(app_handle: AppHandle) -> Result<(), String> {
  let backend = PythonBackend::new(app_handle.clone()).map_err(|e| e.to_string())?;
  backend.start().await.map_err(|e| e.to_string())?;
  
  let state = app_handle.state::<AppState>();
  *state.backend.lock().unwrap() = Some(backend);
  
  Ok(())
}

fn create_backend_setup() -> impl Fn(&mut tauri::App) -> Result<(), Box<dyn std::error::Error>> + Send + Sync + 'static {
  move |app: &mut tauri::App| {
    // Set up window for transparent titlebar on Windows
    #[cfg(target_os = "windows")]
    {
      if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_decorations(false);
        let _ = window.set_title_bar_style(tauri::TitleBarStyle::Overlay);
      }
    }

    let app_handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
      if let Err(e) = start_python_backend(app_handle).await {
        eprintln!("Failed to start Python backend: {}", e);
      }
    });
    Ok(())
  }
}

fn main() {
  run();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let settings = AppSettings::default();
  
  tauri::Builder::default()
    .plugin(tauri_plugin_store::Builder::new().build())
    .plugin(tauri_plugin_log::Builder::default().build())
    // Auto-update. On launch the app asks GitHub for latest.json, verifies its
    // signature against the pubkey in tauri.conf.json, and offers to install.
    // The update replaces the app BUNDLE only — localStorage (playlists, likes,
    // history) lives in the OS webview data dir, so it survives untouched.
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
      let _ = app.get_webview_window("main").map(|w| w.set_focus());
    }))
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_notification::init())
    .plugin(tauri_plugin_clipboard_manager::init())
    .plugin(tauri_plugin_opener::init())
    .setup(create_backend_setup())
    .manage(AppState {
      backend: Arc::new(Mutex::new(None)),
      download_queue: Arc::new(Mutex::new(DownloadQueue::new())),
      settings: Arc::new(Mutex::new(settings)),
    })
    .invoke_handler(tauri::generate_handler![
      greet,
      get_settings,
      update_settings,
      get_backend_status,
      // Search commands
      search_tracks,
      get_suggestions,
      // Download commands
      download_track,
      get_download_status,
      get_download_queue,
      get_stream_url,
      pause_download,
      resume_download,
      cancel_download,
      retry_download,
      clear_completed,
      // File operations
      pick_output_directory,
      open_file_location,
      open_output_folder,
      // Mobile-specific
      request_storage_permission,
      show_media_notification,
      // Source management
      get_sources_status,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}