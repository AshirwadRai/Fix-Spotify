use serde::{Deserialize, Serialize};
use tauri::{State, AppHandle};
use crate::AppState;
use reqwest::Client;

// Types matching the Python backend API
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchRequest {
    pub query: String,
    pub limit: Option<u32>,
    pub mode: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub duration_ms: Option<u32>,
    pub isrc: Option<String>,
    pub sources: serde_json::Value,
    pub primary_source: Option<String>,
    pub search_score: f32,
    pub artwork_url: Option<String>,
    pub artwork_urls: Option<serde_json::Value>,
    pub is_playable: Option<bool>,
    pub playable_source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResponse {
    pub results: Vec<SearchResult>,
    pub total: u32,
    pub query: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Suggestion {
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub sources: Vec<String>,
    pub isrc: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadRequest {
    pub url: String,
    pub track_info: serde_json::Value,
    pub output_dir: Option<String>,
    pub max_bitrate: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadResponse {
    pub task_id: String,
    pub status: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadStatusResponse {
    pub task_id: String,
    pub status: String,
    pub progress: f32,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub file_path: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamResponse {
    pub stream_url: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadTaskInfo {
    pub id: String,
    pub url: String,
    pub track_info: serde_json::Value,
    pub output_path: String,
    pub status: String,
    pub progress: f32,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub speed: f32,
    pub eta: f32,
    pub error: Option<String>,
    pub file_path: Option<String>,
    pub file_size: u64,
    pub bitrate: u32,
    pub codec: String,
    pub created_at: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceStatus {
    pub status: String,
    #[serde(rename = "type")]
    pub source_type: String,
    pub quality: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SuggestionsResponse {
    pub suggestions: Vec<Suggestion>,
}

#[tauri::command]
pub async fn search_tracks(
    query: String,
    mode: Option<String>,
    limit: Option<u32>,
    state: State<'_, AppState>,
) -> Result<SearchResponse, String> {
    // Extract port before await
    let port = {
        let backend_guard = state.backend.lock().unwrap();
        let backend = backend_guard.as_ref().ok_or("Backend not running")?;
        backend.port()
    };
    
    let client = Client::new();
    let url = format!("http://127.0.0.1:{}/api/search", port);
    let response = client.post(&url)
        .json(&serde_json::json!({
            "query": query,
            "limit": limit.unwrap_or(20),
            "mode": mode.unwrap_or_else(|| "fast".to_string()),
        }))
        .send()
        .await
        .map_err(|e| format!("Search request failed: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("Search failed: {}", response.status()));
    }
    
    let result: SearchResponse = response.json().await
        .map_err(|e| format!("Failed to parse search response: {}", e))?;
    
    Ok(result)
}

#[tauri::command]
pub async fn get_suggestions(
    q: String,
    limit: Option<u32>,
    state: State<'_, AppState>,
) -> Result<SuggestionsResponse, String> {
    if q.len() < 2 {
        return Ok(SuggestionsResponse { suggestions: vec![] });
    }
    
    // Extract port before await
    let port = {
        let backend_guard = state.backend.lock().unwrap();
        let backend = backend_guard.as_ref().ok_or("Backend not running")?;
        backend.port()
    };
    
    let client = Client::new();
    let limit = limit.unwrap_or(8).clamp(1, 20);
    
    let url = format!("http://127.0.0.1:{}/api/search/suggestions?q={}&limit={}", 
        port, urlencoding::encode(&q), limit);
    let response = client.get(&url)
        .send()
        .await
        .map_err(|e| format!("Suggestions request failed: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("Suggestions failed: {}", response.status()));
    }
    
    let result: SuggestionsResponse = response.json().await
        .map_err(|e| format!("Failed to parse suggestions response: {}", e))?;
    
    Ok(result)
}

#[tauri::command]
pub async fn download_track(
    _url: String,
    track_info: serde_json::Value,
    output_dir: Option<String>,
    max_bitrate: Option<u32>,
    state: State<'_, AppState>,
) -> Result<DownloadResponse, String> {
    let port = {
        let backend_guard = state.backend.lock().unwrap();
        let backend = backend_guard.as_ref().ok_or("Backend not running")?;
        backend.port()
    };
    
    let client = Client::new();
    let url = format!("http://127.0.0.1:{}/api/download", port);
    
    let response = client.post(&url)
        .json(&serde_json::json!({
            "url": _url,
            "track_info": track_info,
            "output_dir": output_dir.unwrap_or_else(|| ".".to_string()),
            "max_bitrate": max_bitrate.unwrap_or(256),
        }))
        .send()
        .await
        .map_err(|e| format!("Download request failed: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("Download failed: {}", response.status()));
    }
    
    let result: DownloadResponse = response.json().await
        .map_err(|e| format!("Failed to parse download response: {}", e))?;
    
    Ok(result)
}

#[tauri::command]
pub async fn get_download_status(
    task_id: String,
    state: State<'_, AppState>,
) -> Result<DownloadStatusResponse, String> {
    let port = {
        let backend_guard = state.backend.lock().unwrap();
        let backend = backend_guard.as_ref().ok_or("Backend not running")?;
        backend.port()
    };
    
    let client = Client::new();
    let url = format!("http://127.0.0.1:{}/api/download/{}", port, task_id);
    
    let response = client.get(&url)
        .send()
        .await
        .map_err(|e| format!("Status request failed: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("Status request failed: {}", response.status()));
    }
    
    let result: DownloadStatusResponse = response.json().await
        .map_err(|e| format!("Failed to parse status response: {}", e))?;
    
    Ok(result)
}

#[tauri::command]
pub async fn get_stream_url(
    url: String,
    source: String,
    state: State<'_, AppState>,
) -> Result<StreamResponse, String> {
    let port = {
        let backend_guard = state.backend.lock().unwrap();
        let backend = backend_guard.as_ref().ok_or("Backend not running")?;
        backend.port()
    };
    
    let client = Client::new();
    let api_url = format!("http://127.0.0.1:{}/api/stream_url", port);
    
    let response = client.post(&api_url)
        .json(&serde_json::json!({
            "url": url,
            "source": source
        }))
        .send()
        .await
        .map_err(|e| format!("Stream URL request failed: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("Stream request failed: {}", response.status()));
    }
    
    let result: StreamResponse = response.json().await
        .map_err(|e| format!("Failed to parse stream response: {}", e))?;
    
    Ok(result)
}

#[tauri::command]
pub async fn get_download_queue(
    state: State<'_, AppState>,
) -> Result<Vec<DownloadTaskInfo>, String> {
    let queue = state.download_queue.lock().unwrap();
    let tasks: Vec<DownloadTaskInfo> = queue.get_all_tasks()
        .into_iter()
        .map(|t| DownloadTaskInfo {
            id: t.id,
            url: t.url,
            track_info: t.track_info,
            output_path: t.output_path,
            status: t.status.to_string(),
            progress: t.progress,
            downloaded_bytes: t.downloaded_bytes,
            total_bytes: t.total_bytes,
            speed: t.speed,
            eta: t.eta,
            error: t.error,
            file_path: t.file_path,
            file_size: t.file_size,
            bitrate: t.bitrate,
            codec: t.codec,
            created_at: t.created_at,
        })
        .collect();
    Ok(tasks)
}

#[tauri::command]
pub async fn pause_download(
    task_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let queue = state.download_queue.lock().unwrap();
    queue.pause_task(&task_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn resume_download(
    task_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let queue = state.download_queue.lock().unwrap();
    queue.resume_task(&task_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cancel_download(
    task_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let queue = state.download_queue.lock().unwrap();
    queue.cancel_task(&task_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn retry_download(
    task_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let queue = state.download_queue.lock().unwrap();
    queue.retry_task(&task_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clear_completed(
    state: State<'_, AppState>,
) -> Result<u32, String> {
    let queue = state.download_queue.lock().unwrap();
    Ok(queue.clear_completed())
}

#[tauri::command]
pub async fn pick_output_directory(
    app: AppHandle,
) -> Result<Option<String>, String> {
    use std::sync::mpsc;
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = mpsc::channel();
    
    app.dialog().file().pick_folder(move |folder| {
        let _ = tx.send(folder.map(|p| p.to_string()));
    });
    
    Ok(rx.recv().unwrap_or(None))
}

#[tauri::command]
pub async fn open_file_location(
    path: String,
) -> Result<(), String> {
    tauri_plugin_opener::open_path(&path, None::<&str>)
        .map_err(|e| format!("Failed to open file location: {}", e))
}

#[tauri::command]
pub async fn open_output_folder(
    state: State<'_, AppState>,
) -> Result<(), String> {
    let settings = state.settings.lock().unwrap();
    let path = settings.output_directory.as_ref()
        .map(|s| std::path::PathBuf::from(s))
        .unwrap_or_else(|| std::env::current_dir().unwrap());
    drop(settings);
    
    tauri_plugin_opener::open_path(&path, None::<&str>)
        .map_err(|e| format!("Failed to open folder: {}", e))
}

#[tauri::command]
pub async fn request_storage_permission() -> Result<bool, String> {
    #[cfg(target_os = "android")]
    {
        Ok(true)
    }
    #[cfg(not(target_os = "android"))]
    {
        Ok(true)
    }
}

#[tauri::command]
pub async fn show_media_notification(
    title: String,
    artist: String,
    progress: f32,
    app: AppHandle,
) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    
    let body = if progress >= 100.0 {
        format!("Downloaded: {} - {}", title, artist)
    } else {
        format!("Downloading: {} - {} ({:.0}%)", title, artist, progress)
    };
    
    app.notification()
        .builder()
        .title("Fix_Spotify")
        .body(&body)
        .show()
        .map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
pub async fn get_sources_status(
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    // Extract port before await
    let port = {
        let backend_guard = state.backend.lock().unwrap();
        let backend = backend_guard.as_ref().ok_or("Backend not running")?;
        backend.port()
    };
    
    let client = Client::new();
    let url = format!("http://127.0.0.1:{}/api/sources/status", port);
    let response = client.get(&url)
        .send()
        .await
        .map_err(|e| format!("Sources status request failed: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("Sources status failed: {}", response.status()));
    }
    
    let result: serde_json::Value = response.json().await
        .map_err(|e| format!("Failed to parse sources response: {}", e))?;
    
    Ok(result)
}
