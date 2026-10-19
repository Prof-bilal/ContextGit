use portable_pty::{native_pty_system, Child as PtyChild, CommandBuilder, MasterPty, PtySize};
use serde::Deserialize;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use std::{
    env, fs,
    io::{self, Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;
mod updates;
mod voice;

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
    Starting {
        message: String,
    },
    Ready {
        #[serde(rename = "apiBase")]
        api_base: String,
    },
    Error {
        message: String,
    },
}

#[cfg(test)]
mod backend_status_tests {
    use super::BackendStatus;

    #[test]
    fn ready_status_exposes_renderer_api_base() {
        let status = BackendStatus::Ready {
            api_base: "http://127.0.0.1:42929".to_string(),
        };
        assert_eq!(
            serde_json::to_value(status).unwrap(),
            serde_json::json!({ "state": "ready", "apiBase": "http://127.0.0.1:42929" })
        );
    }
}

struct BackendSupervisor {
    child: Mutex<Option<Child>>,
    api_base: Mutex<String>,
    api_token: String,
    last_error: Mutex<Option<String>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Workspace {
    path: String,
    name: String,
    parent: String,
    revision: u64,
}

#[derive(Deserialize, Serialize, Default)]
struct ProjectStore {
    active: Option<String>,
    paths: Vec<String>,
    #[serde(default)]
    revision: u64,
}

struct ProjectSelection(Mutex<()>);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PtyStartOptions {
    id: String,
    command: String,
    #[serde(rename = "sessionId")]
    session_id: Option<String>,
    #[serde(default)]
    resume: bool,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    input: Option<String>,
    env: Option<HashMap<String, String>>,
}

struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    child: Arc<Mutex<Box<dyn PtyChild + Send + Sync>>>,
}

struct PtySupervisor {
    sessions: Arc<Mutex<HashMap<String, PtySession>>>,
}

struct EditorSupervisor {
    processes: Mutex<HashMap<String, EditorProcess>>,
}

#[derive(Default)]
struct NativeLayouts(Mutex<HashMap<String, [i32; 4]>>);

#[derive(Default)]
struct BrowserStates(Mutex<HashMap<String, BrowserState>>);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserState {
    label: String, url: String, title: String, loading: bool, error: Option<String>,
    #[serde(skip)]
    owner: String,
}

struct EditorProcess {
    child: Child,
    _launcher: Option<std::sync::mpsc::Sender<()>>,
    url: String,
    project: PathBuf,
    instance_id: String,
    state_file: PathBuf,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct HarnessCheck {
    id: String,
    command: String,
    installed: bool,
    path: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct HarnessProgress {
    id: String,
    phase: String,
    line: Option<String>,
    percent: Option<f32>,
    path: Option<String>,
    error: Option<String>,
}

fn kill_session(sessions: &Arc<Mutex<HashMap<String, PtySession>>>, id: &str) {
    if let Ok(mut active) = sessions.lock() {
        if let Some(session) = active.remove(id) {
            if let Ok(mut child) = session.child.lock() {
                let _ = child.kill();
            }
        }
    }
}

impl PtySupervisor {
    fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

impl BackendSupervisor {
    fn new() -> Self {
        let port = env::var("CONTEXTGIT_PORT").unwrap_or_else(|_| "8756".to_string());
        Self {
            child: Mutex::new(None),
            api_base: Mutex::new(format!("http://127.0.0.1:{port}")),
            api_token: Uuid::new_v4().to_string(),
            last_error: Mutex::new(None),
        }
    }

    fn api_base(&self) -> Result<String, String> {
        self.api_base
            .lock()
            .map(|value| value.clone())
            .map_err(|_| "Backend address is unavailable".to_string())
    }

    fn set_api_base(&self, value: String) -> Result<(), String> {
        *self
            .api_base
            .lock()
            .map_err(|_| "Backend address is unavailable".to_string())? = value;
        Ok(())
    }

    fn set_error(&self, value: Option<String>) {
        if let Ok(mut error) = self.last_error.lock() {
            *error = value;
        }
    }

    fn error(&self) -> Option<String> {
        self.last_error.lock().ok().and_then(|value| value.clone())
    }
}

impl EditorSupervisor {
    fn new() -> Self {
        Self { processes: Mutex::new(HashMap::new()) }
    }
}

fn backend_command(
    api_base: &str,
    resource_dir: &Path,
    data_dir: &Path,
    api_token: &str,
) -> (Command, String) {
    let port = api_base.rsplit(':').next().unwrap_or("8756");
    let repo = env::var("CONTEXTGIT_REPO")
        .unwrap_or_else(|_| data_dir.join(".contextgit").display().to_string());
    let bundled_name = if cfg!(windows) {
        "contextgit-api.exe"
    } else {
        "contextgit-api"
    };
    let bundled_backend = resource_dir.join("backend").join(bundled_name);
    let bundled = if bundled_backend.is_file() {
        Some(bundled_backend)
    } else {
        None
    };
    let mut command = if !cfg!(debug_assertions) && bundled.is_some() {
        Command::new(bundled.expect("bundled backend checked"))
    } else {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let python = env::var("CONTEXTGIT_PYTHON").unwrap_or_else(|_| {
            if cfg!(windows) {
                let venv = root.join(".venv").join("Scripts").join("python.exe");
                if venv.is_file() {
                    venv.display().to_string()
                } else {
                    "python.exe".to_string()
                }
            } else {
                let venv = root.join(".venv").join("bin").join("python");
                if venv.is_file() {
                    venv.display().to_string()
                } else {
                    "python3".to_string()
                }
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
        if cfg!(debug_assertions) {
            fallback.current_dir(&root);
            let python_path = env::var("PYTHONPATH").unwrap_or_default();
            let root_text = root.display().to_string();
            fallback.env(
                "PYTHONPATH",
                if python_path.is_empty() {
                    root_text
                } else {
                    format!(
                        "{root_text}{0}{python_path}",
                        if cfg!(windows) { ";" } else { ":" }
                    )
                },
            );
        }
        fallback
    };
    command.env("CONTEXTGIT_HOST", "127.0.0.1");
    command.env("CONTEXTGIT_PORT", port);
    command.env("CONTEXTGIT_REPO", &repo);
    command.env("CONTEXTGIT_ROOT", data_dir);
    if !cfg!(debug_assertions) {
        command.env("CONTEXTGIT_MCP_COMMAND", resource_dir.join("backend").join(bundled_name));
    }
    command.env("CONTEXTGIT_DESKTOP_PROJECTS", "1");
    command.env("CONTEXTGIT_API_TOKEN", api_token);
    command.env(
        "CONTEXTGIT_CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,tauri://localhost,http://tauri.localhost",
    );
    fs::create_dir_all(data_dir).ok();
    fs::create_dir_all(Path::new(&repo)).ok();
    let runtime_tmp = data_dir.join("backend-runtime");
    fs::create_dir_all(&runtime_tmp).ok();
    cleanup_runtime_tmp(&runtime_tmp);
    command.current_dir(data_dir);
    // PyInstaller one-file builds extract into a temporary `_MEI*` folder.
    // Keep those folders inside app data and clean only stale extractions.
    command.env("TMPDIR", &runtime_tmp);
    command.env("TMP", &runtime_tmp);
    command.env("TEMP", &runtime_tmp);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    (command, repo)
}

fn cleanup_runtime_tmp(runtime_tmp: &Path) {
    let Ok(entries) = fs::read_dir(runtime_tmp) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with("_MEI"))
        {
            let _ = fs::remove_dir_all(path);
        }
    }
}

fn choose_api_base() -> Result<String, String> {
    if let Ok(port) = env::var("CONTEXTGIT_PORT") {
        let address = format!("127.0.0.1:{port}");
        if TcpListener::bind(&address).is_ok() {
            return Ok(format!("http://{address}"));
        }
    }
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|error| format!("Could not reserve a local backend port: {error}"))?;
    let address = listener
        .local_addr()
        .map_err(|error| format!("Could not read the local backend port: {error}"))?;
    Ok(format!("http://{address}"))
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
    let api_base = choose_api_base()?;
    supervisor.set_api_base(api_base.clone())?;
    let (mut command, _) =
        backend_command(&api_base, resource_dir, data_dir, &supervisor.api_token);
    let mut process = match command.spawn() {
        Ok(process) => process,
        Err(error) => {
            let message = format!("backend could not start: {error}");
            supervisor.set_error(Some(message.clone()));
            return Err(message);
        }
    };
    if let Some(stderr) = process.stderr.take() {
        let log_path = data_dir.join("backend.log");
        thread::spawn(move || {
            let mut stderr = stderr;
            if let Ok(mut log) = fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(log_path)
            {
                let _ = io::copy(&mut stderr, &mut log);
            }
        });
    }
    *child = Some(process);
    supervisor.set_error(None);
    Ok(())
}

fn stop_backend(supervisor: &BackendSupervisor) {
    if let Ok(mut guard) = supervisor.child.lock() {
        if let Some(mut child) = guard.take() {
            // The packaged Python backend can create a child process while it
            // starts. Kill descendants first so a project switch cannot leave
            // the previous repo serving on the shared API port.
            let pid = child.id().to_string();
            #[cfg(unix)]
            {
                let _ = Command::new("pkill").args(["-KILL", "-P", &pid]).status();
            }
            #[cfg(windows)]
            {
                let _ = Command::new("taskkill")
                    .args(["/PID", &pid, "/T", "/F"])
                    .status();
            }
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
async fn backend_status(app: tauri::AppHandle) -> Result<BackendStatus, String> {
    tauri::async_runtime::spawn_blocking(move || read_backend_status(&app.state::<BackendSupervisor>()))
        .await.map_err(|error| error.to_string())
}

fn read_backend_status(supervisor: &BackendSupervisor) -> BackendStatus {
    let api_base = supervisor
        .api_base()
        .unwrap_or_else(|_| "http://127.0.0.1:8756".to_string());
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
    if running && backend_healthy(&api_base) {
        BackendStatus::Ready { api_base }
    } else if running {
        BackendStatus::Starting {
            message: "Waiting for the local ContextGit backend…".to_string(),
        }
    } else {
        BackendStatus::Error {
            message: supervisor
                .error()
                .unwrap_or_else(|| "The local ContextGit backend is not running.".to_string()),
        }
    }
}

#[tauri::command]
fn backend_token(supervisor: tauri::State<'_, BackendSupervisor>) -> String {
    supervisor.api_token.clone()
}

fn restart_backend_blocking(
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
    if let Err(error) = start_backend(&supervisor, &resource_dir, &data_dir) {
        supervisor.set_error(Some(error.clone()));
        let _ = app.emit(
            "backend-status",
            BackendStatus::Error {
                message: error.clone(),
            },
        );
        return Err(error);
    }
    let api_base = supervisor.api_base()?;
    if !wait_for_health(&api_base, Duration::from_secs(30)) {
        return Err(format!(
            "The backend did not become healthy at {}",
            api_base
        ));
    }
    let status = BackendStatus::Ready { api_base };
    let _ = app.emit("backend-status", status.clone());
    Ok(status)
}

#[tauri::command]
async fn restart_backend(app: tauri::AppHandle) -> Result<BackendStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let supervisor = app.state::<BackendSupervisor>();
        restart_backend_blocking(app.clone(), supervisor)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
fn new_window(app: tauri::AppHandle) -> Result<(), String> {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    let label = format!("workspace-{suffix}");
    WebviewWindowBuilder::new(&app, label, WebviewUrl::App("index.html".into()))
        .title("ContextGit")
        .inner_size(1440.0, 920.0)
        .min_inner_size(1100.0, 700.0)
        .resizable(true)
        .build()
        .map(|_| ())
        .map_err(|error| format!("Could not open a new ContextGit window: {error}"))
}

fn workspace_from_path(path: &Path) -> Workspace {
    let resolved = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    Workspace {
        name: resolved
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("Project")
            .to_string(),
        parent: resolved.parent().unwrap_or(&resolved).display().to_string(),
        path: resolved.display().to_string(),
        revision: 0,
    }
}

fn project_store_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("projects.json"))
}

fn read_projects(app: &tauri::AppHandle) -> ProjectStore {
    let Ok(file) = project_store_path(app) else {
        return ProjectStore::default();
    };
    fs::read_to_string(file)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn write_projects(app: &tauri::AppHandle, state: &ProjectStore) -> Result<(), String> {
    let file = project_store_path(app)?;
    let parent = file
        .parent()
        .ok_or_else(|| "Invalid project store path".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    fs::write(
        file,
        serde_json::to_vec_pretty(state).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())
}

fn project_list(app: &tauri::AppHandle) -> Vec<Workspace> {
    read_projects(app)
        .paths
        .iter()
        .map(|path| workspace_from_path(Path::new(path)))
        .collect()
}

fn activate_project(app: &tauri::AppHandle, path: &Path) -> Result<Workspace, String> {
    let selection = app.state::<ProjectSelection>();
    let _guard = selection
        .0
        .lock()
        .map_err(|_| "Project selection is unavailable".to_string())?;
    if !path.is_dir() {
        return Err("Choose an existing folder".to_string());
    }
    let mut workspace = workspace_from_path(path);
    let mut state = read_projects(app);
    if !state.paths.iter().any(|entry| entry == &workspace.path) {
        state.paths.push(workspace.path.clone());
    }
    state.active = Some(workspace.path.clone());
    state.revision += 1;
    workspace.revision = state.revision;
    write_projects(app, &state)?;
    let _ = app.emit("project-changed", workspace.clone());
    Ok(workspace)
}

#[tauri::command]
fn get_workspace(app: tauri::AppHandle) -> Option<Workspace> {
    let state = read_projects(&app);
    state.active.map(|path| {
        let mut workspace = workspace_from_path(Path::new(&path));
        workspace.revision = state.revision;
        workspace
    })
}

#[tauri::command]
fn list_projects(app: tauri::AppHandle) -> Vec<Workspace> {
    project_list(&app)
}

#[tauri::command]
fn use_project(app: tauri::AppHandle, path: String) -> Result<Workspace, String> {
    activate_project(&app, Path::new(&path))
}

#[tauri::command]
fn forget_project(app: tauri::AppHandle, path: String) -> Result<Vec<Workspace>, String> {
    let selection = app.state::<ProjectSelection>();
    let _guard = selection
        .0
        .lock()
        .map_err(|_| "Project selection is unavailable".to_string())?;
    let resolved = workspace_from_path(Path::new(&path)).path;
    let mut state = read_projects(&app);
    state.paths.retain(|entry| entry != &resolved);
    if state.active.as_deref() == Some(&resolved) {
        state.active = state.paths.first().cloned();
    }
    state.revision += 1;
    write_projects(&app, &state)?;
    let _ = app.emit("project-changed", get_workspace(app.clone()));
    Ok(project_list(&app))
}

#[tauri::command]
async fn choose_workspace(app: tauri::AppHandle) -> Result<Option<Workspace>, String> {
    let selected = app.dialog().file().blocking_pick_folder();
    selected
        .map(|path| activate_project(&app, Path::new(&path.to_string())))
        .transpose()
}

#[tauri::command]
async fn pick_workspace_location(app: tauri::AppHandle) -> Result<Option<String>, String> {
    Ok(app
        .dialog()
        .file()
        .blocking_pick_folder()
        .map(|path| path.to_string()))
}

#[tauri::command]
fn create_workspace(
    app: tauri::AppHandle,
    parent: String,
    name: String,
) -> Result<Workspace, String> {
    let name = name.trim();
    if name.is_empty() || name.contains('/') || name.contains('\\') {
        return Err("Folder name cannot contain slashes or be empty".to_string());
    }
    let parent = PathBuf::from(parent);
    if !parent.is_dir() {
        return Err("Choose an existing folder for the location".to_string());
    }
    let target = parent.join(name);
    fs::create_dir_all(&target).map_err(|error| error.to_string())?;
    activate_project(&app, &target)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileNode {
    name: String,
    path: String,
    kind: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileDocument {
    path: String,
    content: String,
    version: String,
    size: u64,
    encoding: String,
}

fn file_version(metadata: &fs::Metadata) -> String {
    format!("{}:{}", metadata.len(), metadata.modified().ok().and_then(|value| value.duration_since(UNIX_EPOCH).ok()).map(|value| value.as_nanos()).unwrap_or_default())
}

fn safe_project_path(project: &str, relative: &str) -> Result<PathBuf, String> {
    let root = fs::canonicalize(project).map_err(|_| "The selected project folder is unavailable".to_string())?;
    let candidate = root.join(relative.trim_start_matches(['/', '\\']));
    let resolved = fs::canonicalize(&candidate).map_err(|_| "That project path is unavailable".to_string())?;
    if resolved != root && !resolved.starts_with(&root) { return Err("Project path escapes the selected folder".to_string()); }
    Ok(resolved)
}

#[tauri::command]
fn files_list(project: String, relative: Option<String>) -> Result<Vec<FileNode>, String> {
    let directory = safe_project_path(&project, relative.as_deref().unwrap_or("."))?;
    if !directory.is_dir() { return Err("Choose a folder in the project".to_string()); }
    let mut entries = fs::read_dir(directory).map_err(|error| error.to_string())?.flatten()
        .filter_map(|entry| {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || ["node_modules", "target", "dist", "build"].contains(&name.as_str()) { return None; }
            let kind = if path.is_dir() { "directory" } else { "file" };
            let relative = path.strip_prefix(fs::canonicalize(&project).ok()?).ok()?.to_string_lossy().replace('\\', "/");
            Some(FileNode { name, path: relative, kind: kind.to_string() })
        }).collect::<Vec<_>>();
    entries.sort_by_key(|entry| (entry.kind != "directory", entry.name.to_lowercase()));
    Ok(entries)
}

#[tauri::command]
fn file_read(project: String, relative: String) -> Result<FileDocument, String> {
    let path = safe_project_path(&project, &relative)?;
    let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
    if metadata.len() > 2_000_000 { return Err("Use a terminal to inspect text files larger than 2 MB".into()); }
    let content = fs::read_to_string(&path).map_err(|_| "This file is not a UTF-8 text file".to_string())?;
    Ok(FileDocument { path: relative, content, version: file_version(&metadata), size: metadata.len(), encoding: "utf8".to_string() })
}

#[tauri::command]
fn file_preview(project: String, relative: String) -> Result<serde_json::Value, String> {
    use base64::Engine;
    let path = safe_project_path(&project, &relative)?;
    let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
    if metadata.len() > 8_000_000 { return Err("Preview supports files up to 8 MB".into()); }
    let extension = path.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase();
    let mime = match extension.as_str() { "png" => Some("image/png"), "jpg" | "jpeg" => Some("image/jpeg"), "gif" => Some("image/gif"), "webp" => Some("image/webp"), _ => None };
    let bytes = fs::read(&path).map_err(|error| error.to_string())?;
    let content = if let Some(kind) = mime { format!("data:{kind};base64,{}", base64::engine::general_purpose::STANDARD.encode(&bytes)) }
        else { String::from_utf8(bytes).map_err(|_| "This binary file has no preview".to_string())? };
    Ok(serde_json::json!({ "path": relative, "size": metadata.len(), "version": file_version(&metadata), "kind": if mime.is_some() { "image" } else if ["md", "markdown"].contains(&extension.as_str()) { "markdown" } else if ["diff", "patch"].contains(&extension.as_str()) { "diff" } else { "text" }, "content": content }))
}

#[tauri::command]
fn file_write(project: String, relative: String, content: String, expected_version: Option<String>) -> Result<FileDocument, String> {
    let path = safe_project_path(&project, &relative)?;
    let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
    if let Some(expected) = expected_version.as_deref() {
        if expected != file_version(&metadata) { return Err("The file changed on disk. Reload it before saving.".to_string()); }
    }
    fs::write(&path, content.as_bytes()).map_err(|error| error.to_string())?;
    file_read(project, relative)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EditorStatus {
    state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    instance_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

fn editor_binary(resource_dir: &Path) -> Option<PathBuf> {
    let configured = env::var_os("CONTEXTGIT_CODE_SERVER").map(PathBuf::from);
    if configured.as_ref().is_some_and(|path| path.is_file()) { return configured; }
    let command = if cfg!(windows) { "code-server.cmd" } else { "code-server" };
    let resolver = if cfg!(windows) { "where" } else { "which" };
    if let Ok(output) = Command::new(resolver).arg(command).output() {
        if output.status.success() {
            if let Some(path) = String::from_utf8_lossy(&output.stdout).lines().next().map(str::trim).filter(|path| !path.is_empty()) { return Some(PathBuf::from(path)); }
        }
    }
    let source_root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../build/editor");
    let bundled_roots = if cfg!(debug_assertions) {
        [source_root, resource_dir.join("editor")]
    } else {
        [resource_dir.join("editor"), source_root]
    };
    for bundled_root in bundled_roots {
        let Ok(entries) = fs::read_dir(bundled_root) else { continue; };
        for entry in entries.flatten() {
            let candidate = if cfg!(windows) { entry.path().join("lib").join("node.exe") } else { entry.path().join("bin").join("code-server") };
            if candidate.is_file() { return Some(candidate); }
        }
    }
    None
}

#[tauri::command]
async fn browser_open_external(url: String) -> Result<(), String> {
    let url = browser_url(&url)?.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "linux")]
        let mut command = Command::new("xdg-open");
        #[cfg(target_os = "macos")]
        let mut command = Command::new("open");
        #[cfg(target_os = "windows")]
        let mut command = { let mut command = Command::new("rundll32.exe"); command.arg("url.dll,FileProtocolHandler"); command };
        let status = command.arg(url).status().map_err(|error| error.to_string())?;
        if status.success() { Ok(()) } else { Err("Could not open the default browser".to_string()) }
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn browser_create(window: tauri::Window, app: tauri::AppHandle, label: String, url: String, x: i32, y: i32, width: i32, height: i32) -> Result<(), String> {
    let destination = browser_url(&url)?;
    if !label.starts_with("contextgit-preview-") { return Err("Invalid browser label".into()); }
    let owner = window.label().to_string();
    {
        let states = app.state::<BrowserStates>();
        let mut states = states.0.lock().map_err(|_| "Browser state is unavailable")?;
        states.retain(|label, _| app.get_webview(label).is_some());
        states.insert(label.clone(), BrowserState { label: label.clone(), owner: owner.clone(), url: destination.to_string(), title: String::new(), loading: true, error: None });
    }
    let navigation_app = app.clone();
    let navigation_label = label.clone();
    let popup_app = app.clone();
    let popup_label = label.clone();
    let builder = tauri::webview::WebviewBuilder::new(&label, WebviewUrl::External(destination))
        .on_navigation(move |url| {
            if !matches!(url.scheme(), "http" | "https") { return false; }
            update_browser(&navigation_app, &navigation_label, |state| { state.url = url.to_string(); state.loading = true; state.error = None; });
            true
        })
        .on_page_load(|view, payload| {
            update_browser(view.app_handle(), view.label(), |state| {
                state.url = payload.url().to_string();
                state.loading = matches!(payload.event(), tauri::webview::PageLoadEvent::Started);
            });
        })
        .on_document_title_changed(|view, title| { update_browser(view.app_handle(), view.label(), |state| state.title = title); })
        .on_new_window(move |url, _features| {
            // Keep target=_blank links inside the managed browser, rather than
            // creating untracked windows that cannot be reclaimed when idle.
            if matches!(url.scheme(), "http" | "https") {
                if let Some(view) = popup_app.get_webview(&popup_label) { let _ = view.navigate(url); }
            }
            tauri::webview::NewWindowResponse::Deny
        });
    let view = window.add_child(builder, tauri::LogicalPosition::new(x.max(0), y.max(0)), tauri::LogicalSize::new(width.max(1), height.max(1)))
        .map_err(|error| error.to_string())?;
    #[cfg(target_os = "linux")]
    {
        let handle = app.clone();
        view.with_webview(move |platform| {
            use webkit2gtk::WebViewExt;
            let uri_handle = handle.clone();
            let uri_label = label.clone();
            platform.inner().connect_uri_notify(move |view| {
                if let Some(uri) = view.uri() {
                    update_browser(&uri_handle, &uri_label, |state| state.url = uri.to_string());
                }
            });
            platform.inner().connect_load_failed(move |_, _, uri, error| {
                if !error.matches(webkit2gtk::NetworkError::Cancelled) {
                    update_browser(&handle, &label, |state| { state.url = uri.into(); state.loading = false; state.error = Some(error.to_string()); });
                }
                false // Retain WebKit's normal error page and certificate checks.
            });
        }).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn browser_url(value: &str) -> Result<tauri::Url, String> {
    let url: tauri::Url = value.parse().map_err(|_| "Enter a valid website address".to_string())?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() { return Err("Only HTTP and HTTPS websites are supported".into()); }
    Ok(url)
}

#[cfg(test)]
mod browser_tests {
    use super::browser_url;
    #[test]
    fn accepts_public_websites_and_local_servers() {
        assert!(browser_url("https://example.com/path").is_ok());
        assert!(browser_url("http://localhost:3000").is_ok());
    }
    #[test]
    fn rejects_non_web_navigation() {
        for value in ["javascript:alert(1)", "file:///etc/passwd", "tauri://localhost", "data:text/html,hello", "not a url"] {
            assert!(browser_url(value).is_err());
        }
    }
}

fn update_browser(app: &tauri::AppHandle, label: &str, update: impl FnOnce(&mut BrowserState)) {
    let states = app.state::<BrowserStates>();
    let snapshot = if let Ok(mut states) = states.0.lock() {
        states.get_mut(label).map(|state| { update(state); state.clone() })
    } else { None };
    if let Some(state) = snapshot { let _ = app.emit_to(state.owner.clone(), "browser-state", state); }
}

#[tauri::command]
fn browser_snapshot(caller: tauri::Webview, label: String) -> Result<BrowserState, String> {
    let states = caller.app_handle().state::<BrowserStates>();
    let states = states.0.lock().map_err(|_| "Browser state is unavailable")?;
    let state = states.get(&label).ok_or("Browser view is closed")?;
    if state.owner != caller.window().label() { return Err("Invalid browser view".into()); }
    Ok(state.clone())
}

#[tauri::command]
fn browser_navigate(caller: tauri::Webview, label: String, url: String) -> Result<(), String> {
    let destination = browser_url(&url)?;
    let view = caller.app_handle().get_webview(&label).ok_or("Browser view is closed")?;
    if view.window().label() != caller.window().label() || !label.starts_with("contextgit-preview-") { return Err("Invalid browser view".into()); }
    view.navigate(destination).map_err(|error| error.to_string())
}

#[tauri::command]
fn native_view_action(caller: tauri::Webview, label: String, action: String) -> Result<(), String> {
    let view = caller.app_handle().get_webview(&label).ok_or("Embedded view is closed")?;
    if view.window().label() != caller.window().label() || !label.starts_with("contextgit-preview-") {
        return Err("Invalid browser view".into());
    }
    match action.as_str() {
        "back" => view.eval("history.back()"),
        "forward" => view.eval("history.forward()"),
        "reload" => view.eval("location.reload()"),
        "stop" => {
            update_browser(caller.app_handle(), &label, |state| state.loading = false);
            view.eval("window.stop()")
        },
        "devtools" => { view.open_devtools(); Ok(()) },
        _ => return Err("Unknown browser action".into()),
    }.map_err(|error| error.to_string())
}

#[tauri::command]
fn native_view_url(caller: tauri::Webview, label: String) -> Result<String, String> {
    let view = caller.app_handle().get_webview(&label).ok_or("Embedded view is closed")?;
    if view.window().label() != caller.window().label() || !label.starts_with("contextgit-preview-") {
        return Err("Invalid browser view".into());
    }
    view.url().map(|url| url.to_string()).map_err(|error| error.to_string())
}

#[tauri::command]
fn native_view_bounds(caller: tauri::Webview, label: String, x: i32, y: i32, width: i32, height: i32) -> Result<(), String> {
    let view = caller.app_handle().get_webview(&label).ok_or("Embedded view is closed")?;
    if view.window().label() != caller.window().label()
        || !(label.starts_with("contextgit-editor-") || label.starts_with("contextgit-preview-")) {
        return Err("Invalid embedded view".into());
    }
    let layouts = caller.app_handle().state::<NativeLayouts>();
    let bounds = [x, y, width, height];
    if let Ok(mut cache) = layouts.0.lock() {
        if cache.get(&label) == Some(&bounds) { return Ok(()); }
        if cache.len() >= 64 { cache.retain(|label, _| caller.app_handle().get_webview(label).is_some()); }
        cache.insert(label, bounds);
    }
    #[cfg(target_os = "linux")]
    {
        // Tauri's Linux runtime packs child webviews into a vertical GtkBox.
        // Position/size calls cannot override that layout: each view takes half
        // the window. Overlay the child on the shell instead, with its DOM bounds.
        view.with_webview(move |platform| {
            use gtk::prelude::*;
            let child = platform.inner();
            let Some(parent) = child.parent() else { return; };
            let overlay = if let Ok(overlay) = parent.clone().downcast::<gtk::Overlay>() {
                overlay
            } else if let Ok(container) = parent.downcast::<gtk::Box>() {
                let existing = container.children().into_iter()
                    .find_map(|widget| widget.downcast::<gtk::Overlay>().ok());
                let overlay = existing.unwrap_or_else(|| {
                    let overlay = gtk::Overlay::new();
                    if let Some(shell) = container.children().into_iter().find(|widget| widget != child.upcast_ref::<gtk::Widget>()) {
                        container.remove(&shell);
                        overlay.add(&shell);
                    }
                    overlay.set_hexpand(true);
                    overlay.set_vexpand(true);
                    container.pack_start(&overlay, true, true, 0);
                    overlay.show();
                    overlay
                });
                container.remove(&child);
                overlay.add_overlay(&child);
                child.set_size_request(-1, -1);
                child.set_halign(gtk::Align::Fill);
                child.set_valign(gtk::Align::Fill);
                overlay
            } else { return; };
            child.set_margin_start(x.max(0));
            child.set_margin_top(y.max(0));
            child.set_margin_end((overlay.allocated_width() - x - width).max(0));
            child.set_margin_bottom((overlay.allocated_height() - y - height).max(0));
        }).map_err(|error| error.to_string())?;
    }
    #[cfg(not(target_os = "linux"))]
    view.set_bounds(tauri::Rect {
        position: tauri::LogicalPosition::new(x, y).into(),
        size: tauri::LogicalSize::new(width.max(1), height.max(1)).into(),
    }).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
async fn editor_start(app: tauri::AppHandle, window: tauri::Window, project: String) -> Result<EditorStatus, String> {
    let owner = window.label().to_string();
    tauri::async_runtime::spawn_blocking(move || start_editor(&app, owner, project))
        .await.map_err(|error| error.to_string())?
}

fn editor_result(state: &str, process: Option<&EditorProcess>, message: Option<String>) -> EditorStatus {
    EditorStatus {
        state: state.into(),
        instance_id: process.map(|process| process.instance_id.clone()),
        url: process.map(|process| process.url.clone()),
        message,
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EditorDocumentState { instance_id: String, dirty: bool, updated_at: u64 }

fn editor_can_release(process: &EditorProcess) -> bool {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64;
    fs::read(&process.state_file).ok().is_some_and(|bytes| editor_state_can_release(&bytes, &process.instance_id, now))
}

fn editor_state_can_release(bytes: &[u8], instance_id: &str, now: u64) -> bool {
    serde_json::from_slice::<EditorDocumentState>(bytes).ok().is_some_and(|state| state.instance_id == instance_id && !state.dirty
        && state.updated_at <= now && now - state.updated_at < 30_000)
}

fn start_editor(app: &tauri::AppHandle, owner: String, project: String) -> Result<EditorStatus, String> {
    use std::hash::{Hash, Hasher};
    let supervisor = app.state::<EditorSupervisor>();
    let root = fs::canonicalize(&project).map_err(|_| "The selected project folder is unavailable".to_string())?;
    let mut processes = supervisor.processes.lock().map_err(|_| "Editor state is unavailable".to_string())?;
    if let Some(process) = processes.get_mut(&owner) {
        if process.child.try_wait().map_err(|error| error.to_string())?.is_none() {
            if process.project == root { return Ok(editor_result("starting", Some(process), None)); }
            if !editor_can_release(process) {
                return Ok(editor_result("retained", Some(process), Some("Save or close unsaved files in the previous project before switching editors. The existing editor has been kept open to protect your work.".into())));
            }
        }
    }
    if let Some(mut process) = processes.remove(&owner) { stop_editor_process(&mut process.child); }
    let resource_dir = app.path().resource_dir().map_err(|error| error.to_string())?;
    let Some(executable) = editor_binary(&resource_dir) else {
        return Ok(editor_result("unavailable", None, Some("Embedded VS Code is not installed. Run `bun run --cwd desktop fetch:editor`, then restart ContextGit.".into())));
    };
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|error| format!("Could not reserve an editor port: {error}"))?;
    let port = listener.local_addr().map_err(|error| error.to_string())?.port();
    drop(listener);
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    root.hash(&mut hash);
    let editor_dir = app.path().app_data_dir().map_err(|error| error.to_string())?.join("editor");
    let data_dir = editor_dir.join("workspaces").join(format!("{}-{:016x}", owner, hash.finish()));
    let extensions = editor_dir.join("extensions");
    let integration = extensions.join("contextgit.contextgit-lifecycle-1.0.0");
    fs::create_dir_all(&data_dir).map_err(|error| error.to_string())?;
    fs::create_dir_all(&integration).map_err(|error| error.to_string())?;
    fs::write(integration.join("package.json"), include_str!("../editor-extension/package.json")).map_err(|error| error.to_string())?;
    fs::write(integration.join("extension.cjs"), include_str!("../editor-extension/extension.cjs")).map_err(|error| error.to_string())?;
    let instance_id = Uuid::new_v4().to_string();
    // Each reporter owns its ledger. A previous process must never overwrite a
    // newer instance's safety state; only the clean layout is shared.
    let state_file = data_dir.join(format!("lifecycle-{instance_id}.json"));
    let log = fs::File::create(data_dir.join("code-server.log")).map_err(|error| error.to_string())?;
    let stderr = log.try_clone().map_err(|error| error.to_string())?;
    let mut command = Command::new(&executable);
    // The official Windows archive ships node.exe plus a .cmd wrapper, not
    // code-server.exe. Launch Node directly to avoid cmd.exe quoting/injection.
    if cfg!(windows) && executable.file_name().is_some_and(|name| name == "node.exe") {
        let root = executable.parent().and_then(Path::parent).ok_or("Invalid editor runtime path")?;
        command.arg(root.join("out").join("node").join("entry.js"));
    }
    command.arg("--config").arg(editor_dir.join("config.yaml"));
    command.env_remove("PORT").env_remove("VSCODE_IPC_HOOK_CLI")
        .env("CONTEXTGIT_EDITOR_STATE_FILE", &state_file).env("CONTEXTGIT_EDITOR_INSTANCE", &instance_id)
        .env("CONTEXTGIT_EDITOR_RESTORE_FILE", data_dir.join("lifecycle.json.restore"));
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    command.args(["--bind-addr", &format!("127.0.0.1:{port}"), "--auth", "none", "--disable-telemetry", "--disable-update-check", "--disable-workspace-trust", "--user-data-dir"])
        .arg(if owner == "main" { editor_dir.join("user-data") } else { editor_dir.join("windows").join(&owner).join("user-data") }).arg("--extensions-dir").arg(&extensions)
        .arg(root.as_os_str()).stdin(Stdio::null()).stdout(Stdio::from(log)).stderr(Stdio::from(stderr));
    let (child, launcher) = spawn_editor_process(command).map_err(|error| format!("Could not start VS Code: {error}"))?;
    let process = EditorProcess {
        child, _launcher: launcher,
        url: format!("http://127.0.0.1:{port}/"), project: root, instance_id, state_file,
    };
    let result = editor_result("starting", Some(&process), None);
    processes.insert(owner, process);
    Ok(result)
}

fn spawn_editor_process(mut command: Command) -> std::io::Result<(Child, Option<std::sync::mpsc::Sender<()>>)> {
    #[cfg(target_os = "linux")]
    {
        let (result_tx, result_rx) = std::sync::mpsc::sync_channel(1);
        let (lifetime_tx, lifetime_rx) = std::sync::mpsc::channel::<()>();
        // Linux's parent-death signal is tied to the spawning *thread*, not
        // merely its process. Keep that thread parked for this editor's life
        // instead of binding it to an expiring async worker-pool thread.
        thread::Builder::new().name("editor-launcher".into()).spawn(move || {
            editor_parent_guard(&mut command);
            if result_tx.send(command.spawn()).is_ok() { let _ = lifetime_rx.recv(); }
        })?;
        let child = result_rx.recv().map_err(|_| std::io::Error::other("Editor launcher stopped"))??;
        Ok((child, Some(lifetime_tx)))
    }
    #[cfg(not(target_os = "linux"))]
    { Ok((command.spawn()?, None)) }
}

// Normal shutdown already stops the process group. Also cover a crashed or
// SIGINT-terminated desktop: code-server handles SIGTERM and disposes its
// children. Only async-signal-safe libc calls may run between fork and exec.
fn editor_parent_guard(command: &mut Command) {
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::process::CommandExt;
        let parent = std::process::id() as libc::pid_t;
        unsafe {
            command.pre_exec(move || {
                if libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGTERM) == -1 {
                    return Err(std::io::Error::last_os_error());
                }
                if libc::getppid() != parent {
                    return Err(std::io::Error::from_raw_os_error(libc::ESRCH));
                }
                Ok(())
            });
        }
    }
    #[cfg(not(target_os = "linux"))]
    let _ = command;
}

#[tauri::command]
async fn editor_status(app: tauri::AppHandle, window: tauri::Window, instance_id: Option<String>) -> Result<EditorStatus, String> {
    let owner = window.label().to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let supervisor = app.state::<EditorSupervisor>();
        let mut processes = supervisor.processes.lock().map_err(|_| "Editor state is unavailable".to_string())?;
        let Some(process) = processes.get_mut(&owner) else { return Ok(editor_result("stopped", None, None)); };
        if instance_id.as_ref().is_some_and(|id| id != &process.instance_id) {
            return Ok(editor_result("stopped", None, Some("A newer editor instance is active.".into())));
        }
        if process.child.try_wait().map_err(|error| error.to_string())?.is_some() {
            return Ok(editor_result("error", None, Some(format!("VS Code stopped. See {}.", process.state_file.with_file_name("code-server.log").display()))));
        }
        let mut result = editor_result("starting", Some(process), None);
        drop(processes);
        if result.url.as_deref().is_some_and(editor_healthy) { result.state = "ready".into(); }
        else { result.url = None; }
        Ok(result)
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn editor_suspend(app: tauri::AppHandle, window: tauri::Window, instance_id: String) -> Result<EditorStatus, String> {
    let owner = window.label().to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let supervisor = app.state::<EditorSupervisor>();
        let mut processes = supervisor.processes.lock().map_err(|_| "Editor state is unavailable".to_string())?;
        let Some(process) = processes.get_mut(&owner) else { return Ok(editor_result("stopped", None, None)); };
        if process.instance_id != instance_id { return Ok(editor_result("stopped", None, None)); }
        if process.child.try_wait().map_err(|error| error.to_string())?.is_none() && !editor_can_release(process) {
            return Ok(editor_result("retained", Some(process), Some("VS Code is kept in memory because files are unsaved or their recovery state is unavailable.".into())));
        }
        if let Some(mut process) = processes.remove(&owner) { stop_editor_process(&mut process.child); }
        Ok(editor_result("stopped", None, None))
    }).await.map_err(|error| error.to_string())?
}

fn editor_healthy(url: &str) -> bool {
    let Some(address) = url.strip_prefix("http://").map(|value| value.trim_end_matches('/')).and_then(|value| value.parse().ok()) else { return false; };
    let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(250)) else { return false; };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(250)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(250)));
    if stream.write_all(b"GET /healthz HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n").is_err() { return false; }
    let mut response = [0_u8; 256];
    let size = stream.read(&mut response).unwrap_or(0);
    String::from_utf8_lossy(&response[..size]).starts_with("HTTP/1.1 200")
}

#[cfg(test)]
mod editor_tests {
    use super::*;

    #[cfg(target_os = "linux")]
    #[test]
    fn editor_lifetime_outlasts_worker_but_not_launcher() {
        let (mut child, lifetime) = thread::spawn(|| {
            let mut command = Command::new("sleep");
            command.arg("60");
            spawn_editor_process(command).unwrap()
        }).join().unwrap();
        assert!(child.try_wait().unwrap().is_none(), "worker exit must not kill editor");
        drop(lifetime);
        let deadline = Instant::now() + Duration::from_secs(3);
        while Instant::now() < deadline {
            if let Some(status) = child.try_wait().unwrap() {
                use std::os::unix::process::ExitStatusExt;
                assert_eq!(status.signal(), Some(libc::SIGTERM));
                return;
            }
            thread::sleep(Duration::from_millis(10));
        }
        let _ = child.kill();
        let _ = child.wait();
        panic!("editor survived launcher shutdown");
    }

    fn probe(response: &'static [u8]) -> bool {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/", listener.local_addr().unwrap());
        let server = thread::spawn(move || {
            let (mut connection, _) = listener.accept().unwrap();
            let mut request = [0_u8; 512];
            let size = connection.read(&mut request).unwrap();
            assert!(String::from_utf8_lossy(&request[..size]).starts_with("GET /healthz "));
            connection.write_all(response).unwrap();
        });
        let ready = editor_healthy(&url);
        server.join().unwrap();
        ready
    }

    #[test]
    fn editor_waits_for_successful_health_response() {
        assert!(probe(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n"));
        assert!(!probe(b"HTTP/1.1 503 Unavailable\r\nContent-Length: 0\r\n\r\n"));
    }

    #[test]
    fn editor_rejects_invalid_health_address() {
        assert!(!editor_healthy("https://example.com/"));
        assert!(!editor_healthy("http://invalid/"));
    }

    #[test]
    fn idle_cleanup_requires_recent_clean_state_from_the_current_instance() {
        let state = br#"{"instanceId":"current","dirty":false,"updatedAt":1000}"#;
        assert!(editor_state_can_release(state, "current", 2000));
        assert!(!editor_state_can_release(state, "newer", 2000));
        assert!(!editor_state_can_release(state, "current", 31_000));
        assert!(!editor_state_can_release(state, "current", 999));
        assert!(!editor_state_can_release(b"{}", "current", 2000));
        assert!(!editor_state_can_release(br#"{"instanceId":"current","dirty":true,"updatedAt":1000}"#, "current", 2000));
    }
}

#[tauri::command]
async fn editor_stop(app: tauri::AppHandle, window: tauri::Window, instance_id: Option<String>) -> Result<(), String> {
    let owner = window.label().to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let supervisor = app.state::<EditorSupervisor>();
        if let Ok(mut processes) = supervisor.processes.lock() {
            if processes.get(&owner).is_some_and(|process| instance_id.as_ref().is_none_or(|id| id == &process.instance_id)) {
                if let Some(mut process) = processes.remove(&owner) { stop_editor_process(&mut process.child); }
            }
        };
    }).await.map_err(|error| error.to_string())
}

fn stop_editor(supervisor: &EditorSupervisor) {
    if let Ok(mut processes) = supervisor.processes.lock() {
        for (_, mut process) in processes.drain() { stop_editor_process(&mut process.child); }
    }
}

fn stop_editor_process(process: &mut Child) {
    if process.try_wait().ok().flatten().is_some() { return; }
    // The launcher starts a VS Code server and extension host. Close the owned
    // process group so those children cannot outlive the embedded editor.
    #[cfg(unix)]
    unsafe { libc::kill(-(process.id() as i32), libc::SIGTERM); }
    #[cfg(windows)]
    { let _ = Command::new("taskkill").args(["/PID", &process.id().to_string(), "/T"]).output(); }
    let deadline = Instant::now() + Duration::from_secs(2);
    while Instant::now() < deadline {
        if process.try_wait().ok().flatten().is_some() {
            // The parent has exited; ensure no owned extension host survives it.
            #[cfg(unix)]
            unsafe { libc::kill(-(process.id() as i32), libc::SIGKILL); }
            return;
        }
        thread::sleep(Duration::from_millis(25));
    }
    #[cfg(unix)]
    unsafe { libc::kill(-(process.id() as i32), libc::SIGKILL); }
    #[cfg(windows)]
    { let _ = Command::new("taskkill").args(["/PID", &process.id().to_string(), "/T", "/F"]).output(); }
    let _ = process.kill();
    let _ = process.wait();
}

fn shell_command() -> String {
    if cfg!(windows) {
        env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string())
    } else {
        env::var("SHELL").unwrap_or_else(|_| "sh".to_string())
    }
}

fn harness_command(id: &str) -> (String, Vec<String>) {
    match id {
        "antigravity" => ("agy".to_string(), Vec::new()),
        "commandcode" => ("command-code".to_string(), Vec::new()),
        "ollama" => ("ollama".to_string(), vec!["run".to_string()]),
        "shell" | "terminal" | "" => (shell_command(), Vec::new()),
        other => (other.to_string(), Vec::new()),
    }
}

fn npm_package(id: &str) -> Option<(&'static str, bool)> {
    match id {
        "freebuff" => Some(("freebuff", false)),
        "cline" => Some(("cline", false)),
        "pi" => Some(("@earendil-works/pi-coding-agent", true)),
        "kilo" => Some(("@kilocode/cli", false)),
        "commandcode" => Some(("command-code", false)),
        _ => None,
    }
}

fn find_harness(id: &str) -> HarnessCheck {
    let (command, _) = harness_command(id);
    if id == "shell" || id == "terminal" {
        return HarnessCheck {
            id: id.to_string(),
            command,
            installed: true,
            path: None,
        };
    }
    let resolver = if cfg!(windows) { "where" } else { "which" };
    let output = Command::new(resolver).arg(&command).output().ok();
    let mut path = output.and_then(|value| {
        if value.status.success() {
            String::from_utf8_lossy(&value.stdout)
                .lines()
                .next()
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .map(str::to_string)
        } else {
            None
        }
    });
    // Some desktop installations put a mise installer wrapper on PATH. Its
    // global setup check runs on every launch; use the already installed CLI.
    if let Some(wrapper) = path.as_deref() {
        if fs::metadata(wrapper).is_ok_and(|metadata| metadata.len() < 4096) {
            if let Ok(source) = fs::read_to_string(wrapper) {
                if source.contains("mise use -g") && source.contains("exec mise x") {
                    if let Ok(resolved) = Command::new("mise").args(["which", &command]).output() {
                        let executable =
                            String::from_utf8_lossy(&resolved.stdout).trim().to_string();
                        if resolved.status.success() && Path::new(&executable).is_file() {
                            path = Some(executable);
                        }
                    }
                }
            }
        }
    }
    HarnessCheck {
        id: id.to_string(),
        command,
        installed: path.is_some(),
        path,
    }
}

#[tauri::command]
fn harness_check(id: String) -> HarnessCheck {
    find_harness(&id)
}

#[tauri::command]
fn harness_install(app: tauri::AppHandle, id: String) -> Result<serde_json::Value, String> {
    let Some((package, ignore_scripts)) = npm_package(&id) else {
        return Err(format!(
            "{id} cannot be installed automatically; install its CLI and restart ContextGit."
        ));
    };
    let install_app = app.clone();
    thread::spawn(move || {
        let emit = |phase: &str,
                    line: Option<String>,
                    percent: Option<f32>,
                    path: Option<String>,
                    error: Option<String>| {
            let _ = install_app.emit(
                "harness-progress",
                HarnessProgress {
                    id: id.clone(),
                    phase: phase.to_string(),
                    line,
                    percent,
                    path,
                    error,
                },
            );
        };
        emit(
            "installing",
            Some(format!("Installing {package} with npm…")),
            Some(0.2),
            None,
            None,
        );
        let node = Command::new(if cfg!(windows) { "node.exe" } else { "node" }).arg("--version").output();
        let npm = Command::new(if cfg!(windows) { "npm.cmd" } else { "npm" }).arg("--version").output();
        if node.as_ref().map(|output| !output.status.success()).unwrap_or(true) || npm.as_ref().map(|output| !output.status.success()).unwrap_or(true) {
            emit("error", None, None, None, Some("Node.js and npm are required before installing this agent. Install Node.js from https://nodejs.org/ and read https://docs.npmjs.com/downloading-and-installing-node-js-and-npm, then retry.".to_string()));
            return;
        }
        let mut command = Command::new(if cfg!(windows) { "npm.cmd" } else { "npm" });
        command.args(["install", "--global", package]);
        if ignore_scripts {
            command.arg("--ignore-scripts");
        }
        match command.output() {
            Ok(output) if output.status.success() => {
                let check = find_harness(&id);
                if check.installed {
                    emit(
                        "done",
                        Some("Installation verified.".to_string()),
                        Some(1.0),
                        check.path,
                        None,
                    );
                } else {
                    emit("error", None, None, None, Some("Installation completed, but the CLI is not on PATH. Restart ContextGit and try again.".to_string()));
                }
            }
            Ok(output) => emit(
                "error",
                None,
                None,
                None,
                Some(String::from_utf8_lossy(&output.stderr).trim().to_string()),
            ),
            Err(error) => emit("error", None, None, None, Some(error.to_string())),
        }
    });
    Ok(serde_json::json!({ "started": true }))
}

#[tauri::command]
fn pty_start(
    app: tauri::AppHandle,
    supervisor: tauri::State<'_, PtySupervisor>,
    options: PtyStartOptions,
) -> Result<(), String> {
    kill_session(&supervisor.sessions, &options.id);
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: options.rows.max(5),
            cols: options.cols.max(20),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("Could not open terminal: {error}"))?;
    let (program, args) = harness_command(&options.command);
    let executable = find_harness(&options.command).path.unwrap_or(program);
    let mut command = CommandBuilder::new(executable);
    command.args(args);
    // Reopening a stored run resumes its native CLI session instead of
    // starting a second conversation. The PTY remains disposable; the
    // backend session and worktree are the durable identity.
    if options.resume {
        let Some(session_id) = options.session_id.as_deref() else { return Err("Cannot resume a terminal without a session id".to_string()); };
        match options.command.as_str() {
            "claude" => {
                let native_id = Uuid::parse_str(session_id).map_err(|_| "Invalid Claude session UUID".to_string())?.to_string();
                command.args(["--resume", &native_id]);
            },
            // Codex owns the native conversation id. --last resumes the most
            // recent recorded session for this worktree without opening the
            // interactive picker.
            "codex" => command.args(["resume", "--last"]),
            "opencode" => command.args(["--continue"]),
            _ => {}
        }
    } else {
        if options.command == "claude" {
            if let Some(session_id) = options.session_id.as_deref() {
                let native_id = Uuid::parse_str(session_id).map_err(|_| "Invalid Claude session UUID".to_string())?.to_string();
                command.args(["--session-id", &native_id]);
            }
        }
        if ["claude", "codex"].contains(&options.command.as_str()) {
            if let Some(input) = options.input.as_deref().filter(|value| !value.trim().is_empty()) { command.arg(input); }
        }
    }
    // Give shells and full-screen CLIs a predictable terminal even when the
    // desktop app was launched from a graphical session without TERM set.
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    if let Some(cwd) = options.cwd.as_deref() {
        command.cwd(cwd);
    }
    if let Some(values) = options.env.as_ref() {
        for (key, value) in values {
            command.env(key, value);
        }
    }
    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| format!("Could not launch terminal: {error}"))?;
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| format!("Could not read terminal: {error}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| format!("Could not write terminal: {error}"))?;
    let child = Arc::new(Mutex::new(child));
    let writer = Arc::new(Mutex::new(writer));
    let id = options.id;
    let sessions = supervisor.sessions.clone();
    let session = PtySession {
        master: pair.master,
        writer: writer.clone(),
        child: child.clone(),
    };
    sessions
        .lock()
        .map_err(|_| "Terminal state is unavailable".to_string())?
        .insert(id.clone(), session);

    let output_app = app.clone();
    let output_id = id.clone();
    thread::spawn(move || {
        let mut reader = reader;
        let mut buffer = [0_u8; 16 * 1024];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(size) => {
                    let data = String::from_utf8_lossy(&buffer[..size]).to_string();
                    let _ = output_app.emit(
                        "pty-data",
                        serde_json::json!({ "id": output_id, "data": data }),
                    );
                }
            }
        }
    });

    let exit_app = app.clone();
    let exit_id = id.clone();
    let exit_sessions = sessions.clone();
    thread::spawn(move || {
        // Poll instead of holding the child mutex across a blocking wait.
        // pty_kill needs this mutex to stop the process when its pane closes;
        // holding it here makes the entire Tauri command thread hang forever.
        let code = loop {
            let result = child
                .lock()
                .ok()
                .and_then(|mut process| process.try_wait().ok());
            match result {
                Some(Some(status)) => break Some(status.exit_code()),
                Some(None) => thread::sleep(Duration::from_millis(50)),
                None => break None,
            }
        };
        let _ = exit_app.emit(
            "pty-exit",
            serde_json::json!({ "id": exit_id, "code": code }),
        );
        if let Ok(mut active) = exit_sessions.lock() {
            active.remove(&id);
        }
    });

    if let Some(input) = options.input.filter(|value| !value.trim().is_empty() && !["claude", "codex"].contains(&options.command.as_str())) {
        let input_writer = writer;
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(700));
            if let Ok(mut target) = input_writer.lock() {
                let _ = target.write_all(input.trim().as_bytes());
                let _ = target.write_all(b"\r");
                let _ = target.flush();
            }
        });
    }
    Ok(())
}

#[tauri::command]
fn pty_write(
    supervisor: tauri::State<'_, PtySupervisor>,
    id: String,
    data: String,
) -> Result<(), String> {
    let sessions = supervisor
        .sessions
        .lock()
        .map_err(|_| "Terminal state is unavailable".to_string())?;
    if let Some(session) = sessions.get(&id) {
        let mut writer = session
            .writer
            .lock()
            .map_err(|_| "Terminal writer is unavailable".to_string())?;
        writer
            .write_all(data.as_bytes())
            .map_err(|error| error.to_string())?;
        writer.flush().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn pty_resize(
    supervisor: tauri::State<'_, PtySupervisor>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = supervisor
        .sessions
        .lock()
        .map_err(|_| "Terminal state is unavailable".to_string())?;
    if let Some(session) = sessions.get(&id) {
        session
            .master
            .resize(PtySize {
                rows: rows.max(5),
                cols: cols.max(20),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn pty_kill(supervisor: tauri::State<'_, PtySupervisor>, id: String) {
    kill_session(&supervisor.sessions, &id);
}

#[tauri::command]
fn pty_presets() -> Vec<String> {
    [
        "claude",
        "codex",
        "opencode",
        "antigravity",
        "aider",
        "ollama",
        "shell",
    ]
    .into_iter()
    .map(str::to_string)
    .collect()
}

#[tauri::command]
async fn save_file(
    app: tauri::AppHandle,
    default_name: String,
    data: Vec<u8>,
) -> Result<Option<String>, String> {
    let path = app
        .dialog()
        .file()
        .set_file_name(&default_name)
        .blocking_save_file();
    let Some(path) = path else {
        return Ok(None);
    };
    let path = path.to_string();
    fs::write(&path, data).map_err(|error| error.to_string())?;
    Ok(Some(path))
}

fn trusted_microphone_window(label: &str, url: &tauri::Url) -> bool {
    let app_window = label == "main" || label.starts_with("workspace-");
    let bundled = (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
        || (matches!(url.scheme(), "http" | "https")
            && url.host_str() == Some("tauri.localhost"));
    let development = cfg!(debug_assertions)
        && url.scheme() == "http"
        && url.host_str() == Some("localhost")
        && url.port() == Some(5173);
    app_window && (bundled || development)
}

#[cfg(test)]
mod microphone_permission_tests {
    use super::trusted_microphone_window;

    #[test]
    fn microphone_is_restricted_to_local_app_windows() {
        let app = tauri::Url::parse("tauri://localhost/index.html").unwrap();
        assert!(trusted_microphone_window("main", &app));
        assert!(trusted_microphone_window("workspace-123", &app));
        assert!(!trusted_microphone_window("browser-123", &app));
        let website = tauri::Url::parse("https://example.com").unwrap();
        assert!(!trusted_microphone_window("main", &website));
        let spoof = tauri::Url::parse("https://tauri.localhost.example.com").unwrap();
        assert!(!trusted_microphone_window("main", &spoof));
    }
}

fn main() {
    let app = tauri::Builder::default()
        .on_permission_request(|webview, kind| {
            use tauri::webview::{PermissionKind, PermissionResponse};
            if matches!(kind, PermissionKind::Microphone) {
                if webview.url().is_ok_and(|url| trusted_microphone_window(webview.label(), &url)) {
                    PermissionResponse::Allow
                } else {
                    PermissionResponse::Deny
                }
            } else {
                PermissionResponse::Default
            }
        })
        .manage(BackendSupervisor::new())
        .manage(EditorSupervisor::new())
        .manage(NativeLayouts::default())
        .manage(BrowserStates::default())
        .manage(ProjectSelection(Mutex::new(())))
        .manage(PtySupervisor::new())
        .manage(updates::UpdateService::default())
        .manage(voice::VoiceState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            let supervisor = app.state::<BackendSupervisor>();
            let resource_dir = app.path().resource_dir().map_err(io::Error::other)?;
            let data_dir = app.path().app_data_dir().map_err(io::Error::other)?;
            let _ = app.emit(
                "backend-status",
                BackendStatus::Starting {
                    message: "Starting the local ContextGit backend…".to_string(),
                },
            );
            if let Err(error) = start_backend(&supervisor, &resource_dir, &data_dir) {
                supervisor.set_error(Some(error.clone()));
                let _ = app.emit("backend-status", BackendStatus::Error { message: error });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            runtime_info,
            voice::voice_model_status,
            voice::voice_model_download,
            voice::voice_model_remove,
            voice::voice_cancel,
            voice::voice_transcribe,
            backend_status,
            backend_token,
            restart_backend,
            app_version,
            updates::check_for_updates,
            updates::download_update,
            updates::install_update,
            updates::open_update_release,
            new_window,
            get_workspace,
            list_projects,
            use_project,
            forget_project,
            choose_workspace,
            pick_workspace_location,
            create_workspace,
            files_list,
            file_read,
            file_preview,
            file_write,
            native_view_bounds,
            native_view_url,
            native_view_action,
            browser_create,
            browser_snapshot,
            browser_navigate,
            browser_open_external,
            editor_start,
            editor_status,
            editor_suspend,
            editor_stop,
            pty_start,
            pty_write,
            pty_resize,
            pty_kill,
            pty_presets,
            save_file,
            harness_check,
            harness_install
        ])
        .build(tauri::generate_context!())
        .expect("error while building ContextGit Tauri application");
    app.run(|app_handle, event| {
        if let RunEvent::WindowEvent { label, event: tauri::WindowEvent::Destroyed, .. } = &event {
            let app = app_handle.clone();
            let owner = label.clone();
            tauri::async_runtime::spawn_blocking(move || {
                let supervisor = app.state::<EditorSupervisor>();
                if let Ok(mut processes) = supervisor.processes.lock() {
                    if let Some(mut process) = processes.remove(&owner) { stop_editor_process(&mut process.child); }
                };
            });
        }
        if matches!(event, RunEvent::Exit | RunEvent::ExitRequested { .. }) {
            stop_backend(&app_handle.state::<BackendSupervisor>());
            stop_editor(&app_handle.state::<EditorSupervisor>());
        }
    });
}
