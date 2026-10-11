use serde::Serialize;
use std::{
    env, fs,
    io::{self, Read, Write},
    net::TcpStream,
    path::Path,
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};
use tauri::{Manager, RunEvent};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeInfo {
    platform: String,
    arch: String,
    shell: String,
}

#[derive(Clone, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
enum BackendStatus {
    Starting { message: String },
    Ready { api_base: String },
    Error { message: String },
}

struct BackendSupervisor {
    child: Mutex<Option<Child>>,
    api_base: String,
}

impl BackendSupervisor {
    fn new() -> Self {
        let port = env::var("CONTEXTGIT_PORT").unwrap_or_else(|_| "8756".to_string());
        Self {
            child: Mutex::new(None),
            api_base: format!("http://127.0.0.1:{port}"),
        }
    }
}

fn backend_command(api_base: &str, resource_dir: &Path, data_dir: &Path) -> (Command, String) {
    let port = api_base.rsplit(':').next().unwrap_or("8756");
    let repo = env::var("CONTEXTGIT_REPO")
        .unwrap_or_else(|_| data_dir.join(".contextgit").display().to_string());
    let bundled_name = if cfg!(windows) {
        "contextgit-api.exe"
    } else {
        "contextgit-api"
    };
    let bundled_backend = resource_dir.join("backend").join(bundled_name);
    let mut command = if !cfg!(debug_assertions) && bundled_backend.is_file() {
        Command::new(bundled_backend)
    } else {
        let python = env::var("CONTEXTGIT_PYTHON").unwrap_or_else(|_| {
            if cfg!(windows) {
                "python.exe".to_string()
            } else {
                "python3".to_string()
            }
        });
        let mut fallback = Command::new(python);
        fallback.args([
            "-m",
            "uvicorn",
            "contextgit.api.main:app",
            "--host",
            "127.0.0.1",
            "--port",
            port,
        ]);
        fallback
    };
    command.env("CONTEXTGIT_HOST", "127.0.0.1");
    command.env("CONTEXTGIT_PORT", port);
    command.env("CONTEXTGIT_REPO", &repo);
    command.env("CONTEXTGIT_ROOT", data_dir);
    command.env(
        "CONTEXTGIT_API_TOKEN",
        env::var("CONTEXTGIT_API_TOKEN").unwrap_or_else(|_| "tauri-local-token".to_string()),
    );
    command.env(
        "CONTEXTGIT_CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,tauri://localhost,http://tauri.localhost",
    );
    fs::create_dir_all(data_dir).ok();
    fs::create_dir_all(Path::new(&repo)).ok();
    command.current_dir(data_dir);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    (command, repo)
}

fn backend_healthy(api_base: &str) -> bool {
    let port = api_base.rsplit(':').next().unwrap_or("8756");
    let address = format!("127.0.0.1:{port}");
    let Ok(mut stream) = TcpStream::connect_timeout(
        &address
            .parse()
            .unwrap_or_else(|_| "127.0.0.1:8756".parse().unwrap()),
        Duration::from_millis(250),
    ) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(250)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(250)));
    if stream
        .write_all(b"GET /api/v1/health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .is_err()
    {
        return false;
    }
    let mut response = [0_u8; 256];
    let size = stream.read(&mut response).unwrap_or(0);
    String::from_utf8_lossy(&response[..size]).contains(" 200 ")
}

fn wait_for_health(api_base: &str, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if backend_healthy(api_base) {
            return true;
        }
        thread::sleep(Duration::from_millis(250));
    }
    false
}

fn start_backend(
    supervisor: &BackendSupervisor,
    resource_dir: &Path,
    data_dir: &Path,
) -> Result<(), String> {
    let mut child = supervisor
        .child
        .lock()
        .map_err(|_| "backend lock poisoned".to_string())?;
    if child
        .as_mut()
        .and_then(|process| process.try_wait().ok())
        .flatten()
        .is_some()
    {
        *child = None;
    }
    if child.is_some() {
        return Ok(());
    }
    let (mut command, _) = backend_command(&supervisor.api_base, resource_dir, data_dir);
    *child = Some(
        command
            .spawn()
            .map_err(|error| format!("backend could not start: {error}"))?,
    );
    Ok(())
}

fn stop_backend(supervisor: &BackendSupervisor) {
    if let Ok(mut guard) = supervisor.child.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[tauri::command]
fn runtime_info() -> RuntimeInfo {
    RuntimeInfo {
        platform: env::consts::OS.to_string(),
        arch: env::consts::ARCH.to_string(),
        shell: env::var("SHELL")
            .or_else(|_| env::var("COMSPEC"))
            .unwrap_or_else(|_| "sh".to_string()),
    }
}

#[tauri::command]
fn backend_status(supervisor: tauri::State<'_, BackendSupervisor>) -> BackendStatus {
    let running = supervisor
        .child
        .lock()
        .ok()
        .and_then(|mut child| {
            child
                .as_mut()
                .map(|process| process.try_wait().ok().flatten().is_none())
        })
        .unwrap_or(false);
    if running && backend_healthy(&supervisor.api_base) {
        BackendStatus::Ready {
            api_base: supervisor.api_base.clone(),
        }
    } else if running {
        BackendStatus::Starting {
            message: "Waiting for the local ContextGit backend…".to_string(),
        }
    } else {
        BackendStatus::Error {
            message: "The local ContextGit backend is not running.".to_string(),
        }
    }
}

#[tauri::command]
fn restart_backend(
    app: tauri::AppHandle,
    supervisor: tauri::State<'_, BackendSupervisor>,
) -> Result<BackendStatus, String> {
    stop_backend(&supervisor);
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?;
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    start_backend(&supervisor, &resource_dir, &data_dir)?;
    if !wait_for_health(&supervisor.api_base, Duration::from_secs(30)) {
        return Err(format!(
            "The backend did not become healthy at {}",
            supervisor.api_base
        ));
    }
    Ok(BackendStatus::Ready {
        api_base: supervisor.api_base.clone(),
    })
}

#[tauri::command]
fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

fn main() {
    let app = tauri::Builder::default()
        .manage(BackendSupervisor::new())
        .setup(|app| {
            let supervisor = app.state::<BackendSupervisor>();
            let resource_dir = app.path().resource_dir().map_err(io::Error::other)?;
            let data_dir = app.path().app_data_dir().map_err(io::Error::other)?;
            start_backend(&supervisor, &resource_dir, &data_dir).map_err(io::Error::other)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            runtime_info,
            backend_status,
            restart_backend,
            app_version
        ])
        .build(tauri::generate_context!())
        .expect("error while building ContextGit Tauri application");
    app.run(|app_handle, event| {
        if matches!(event, RunEvent::Exit) {
            stop_backend(&app_handle.state::<BackendSupervisor>());
        }
    });
}
