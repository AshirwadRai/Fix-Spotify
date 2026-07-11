use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum TaskStatus {
    Pending,
    Queued,
    Downloading,
    Paused,
    Completed,
    Failed,
    Cancelled,
}

impl std::fmt::Display for TaskStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TaskStatus::Pending => write!(f, "pending"),
            TaskStatus::Queued => write!(f, "queued"),
            TaskStatus::Downloading => write!(f, "downloading"),
            TaskStatus::Paused => write!(f, "paused"),
            TaskStatus::Completed => write!(f, "completed"),
            TaskStatus::Failed => write!(f, "failed"),
            TaskStatus::Cancelled => write!(f, "cancelled"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadTask {
    pub id: String,
    pub url: String,
    pub track_info: serde_json::Value,
    pub output_path: String,
    pub max_bitrate: u32,
    pub status: TaskStatus,
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
    pub retries: u32,
    pub created_at: f64,
    pub started_at: Option<f64>,
    pub completed_at: Option<f64>,
}

pub struct DownloadQueue {
    tasks: Arc<Mutex<HashMap<String, DownloadTask>>>,
    max_concurrent: usize,
    active_count: Arc<Mutex<usize>>,
}

impl DownloadQueue {
    pub fn new() -> Self {
        Self {
            tasks: Arc::new(Mutex::new(HashMap::new())),
            max_concurrent: 3,
            active_count: Arc::new(Mutex::new(0)),
        }
    }
    
    pub fn add_task(&self, url: String, track_info: serde_json::Value, output_path: String, max_bitrate: u32) -> String {
        let task_id = Uuid::new_v4().to_string();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs_f64();
        
        let task = DownloadTask {
            id: task_id.clone(),
            url,
            track_info,
            output_path,
            max_bitrate,
            status: TaskStatus::Pending,
            progress: 0.0,
            downloaded_bytes: 0,
            total_bytes: 0,
            speed: 0.0,
            eta: 0.0,
            error: None,
            file_path: None,
            file_size: 0,
            bitrate: 0,
            codec: String::new(),
            retries: 0,
            created_at: now,
            started_at: None,
            completed_at: None,
        };
        
        let mut tasks = self.tasks.lock().unwrap();
        tasks.insert(task_id.clone(), task);
        task_id
    }
    
    pub fn get_task(&self, task_id: &str) -> Option<DownloadTask> {
        let tasks = self.tasks.lock().unwrap();
        tasks.get(task_id).cloned()
    }
    
    pub fn get_all_tasks(&self) -> Vec<DownloadTask> {
        let tasks = self.tasks.lock().unwrap();
        tasks.values().cloned().collect()
    }
    
    pub fn get_tasks_by_status(&self, status: TaskStatus) -> Vec<DownloadTask> {
        let tasks = self.tasks.lock().unwrap();
        tasks.values()
            .filter(|t| t.status == status)
            .cloned()
            .collect()
    }
    
    pub fn update_task<F>(&self, task_id: &str, f: F) -> Result<(), String>
    where
        F: FnOnce(&mut DownloadTask),
    {
        let mut tasks = self.tasks.lock().unwrap();
        if let Some(task) = tasks.get_mut(task_id) {
            f(task);
            Ok(())
        } else {
            Err("Task not found".to_string())
        }
    }
    
    pub fn pause_task(&self, task_id: &str) -> Result<(), String> {
        self.update_task(task_id, |task| {
            if task.status == TaskStatus::Downloading || task.status == TaskStatus::Queued {
                task.status = TaskStatus::Paused;
            }
        })
    }
    
    pub fn resume_task(&self, task_id: &str) -> Result<(), String> {
        self.update_task(task_id, |task| {
            if task.status == TaskStatus::Paused {
                task.status = TaskStatus::Queued;
            }
        })
    }
    
    pub fn cancel_task(&self, task_id: &str) -> Result<(), String> {
        self.update_task(task_id, |task| {
            if matches!(task.status, TaskStatus::Pending | TaskStatus::Queued | TaskStatus::Downloading | TaskStatus::Paused) {
                task.status = TaskStatus::Cancelled;
                task.error = Some("Cancelled by user".to_string());
            }
        })
    }
    
    pub fn retry_task(&self, task_id: &str) -> Result<(), String> {
        self.update_task(task_id, |task| {
            if task.status == TaskStatus::Failed || task.status == TaskStatus::Cancelled {
                task.status = TaskStatus::Pending;
                task.error = None;
                task.retries += 1;
                task.progress = 0.0;
                task.downloaded_bytes = 0;
                task.speed = 0.0;
                task.eta = 0.0;
            }
        })
    }
    
    pub fn clear_completed(&self) -> u32 {
        let mut tasks = self.tasks.lock().unwrap();
        let initial_len = tasks.len();
        tasks.retain(|_, task| task.status != TaskStatus::Completed);
        (initial_len - tasks.len()) as u32
    }
    
    pub fn can_start_new(&self) -> bool {
        let active = self.active_count.lock().unwrap();
        *active < self.max_concurrent
    }
    
    pub fn increment_active(&self) {
        let mut active = self.active_count.lock().unwrap();
        *active += 1;
    }
    
    pub fn decrement_active(&self) {
        let mut active = self.active_count.lock().unwrap();
        if *active > 0 {
            *active -= 1;
        }
    }
}

impl Default for DownloadQueue {
    fn default() -> Self {
        Self::new()
    }
}