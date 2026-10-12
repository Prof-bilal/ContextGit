use portable_pty::{native_pty_system, Child as PtyChild, CommandBuilder, MasterPty, PtySize};
use serde::Deserialize;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use std::{
    env, fs,
    io::{self, Read, Write},
    net::TcpStream,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager, RunEvent};
use tauri_plugin_dialog::DialogExt;

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

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Workspace {
    path: String,
    name: String,
    parent: String,
}

#[derive(Deserialize, Serialize, Default)]
struct ProjectStore {
    active: Option<String>,
    paths: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PtyStartOptions {
    id: String,
    command: String,
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
    let bundled = if bundled_backend.is_file() {
        Some(bundled_backend)
    } else {
        None
    };
    let mut command = if !cfg!(debug_assertions) && bundled.is_some() {
        Command::new(bundled.expect("bundled backend checked"))
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
        if cfg!(debug_assertions) {
            let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
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
        .stderr(if cfg!(debug_assertions) {
            Stdio::inherit()
        } else {
            Stdio::null()
        });
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
            // The packaged Python backend can create a child process while it
            // starts. Kill descendants first so a project switch cannot leave
            // the previous repo serving on the shared API port.
            let pid = child.id().to_string();
            #[cfg(unix)]
            {
                let _ = Command::new("pkill")
                    .args(["-KILL", "-P", &pid])
                    .status();
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
    set_backend_repo(&app);
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

fn set_backend_repo(app: &tauri::AppHandle) {
    let repo = read_projects(app)
        .active
        .map(|path| PathBuf::from(path).join(".contextgit"));
    match repo {
        Some(path) => env::set_var("CONTEXTGIT_REPO", path),
        None => env::remove_var("CONTEXTGIT_REPO"),
    }
}

fn project_list(app: &tauri::AppHandle) -> Vec<Workspace> {
    read_projects(app)
        .paths
        .iter()
        .map(|path| workspace_from_path(Path::new(path)))
        .collect()
}

fn activate_project(app: &tauri::AppHandle, path: &Path) -> Result<Workspace, String> {
    if !path.is_dir() {
        return Err("Choose an existing folder".to_string());
    }
    let workspace = workspace_from_path(path);
    let mut state = read_projects(app);
    if !state.paths.iter().any(|entry| entry == &workspace.path) {
        state.paths.push(workspace.path.clone());
    }
    state.active = Some(workspace.path.clone());
    write_projects(app, &state)?;
    set_backend_repo(app);
    Ok(workspace)
}

#[tauri::command]
fn get_workspace(app: tauri::AppHandle) -> Option<Workspace> {
    read_projects(&app)
        .active
        .map(|path| workspace_from_path(Path::new(&path)))
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
    let resolved = workspace_from_path(Path::new(&path)).path;
    let mut state = read_projects(&app);
    state.paths.retain(|entry| entry != &resolved);
    if state.active.as_deref() == Some(&resolved) {
        state.active = state.paths.first().cloned();
    }
    write_projects(&app, &state)?;
    set_backend_repo(&app);
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

fn shell_command() -> String {
    if cfg!(windows) {
        env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string())
    } else {
        env::var("SHELL").unwrap_or_else(|_| "sh".to_string())
    }
}

fn harness_command(id: &str) -> (String, Vec<String>) {
    match id {
        "ollama" => ("ollama".to_string(), vec!["run".to_string()]),
        "shell" | "" => (shell_command(), Vec::new()),
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
    if id == "shell" {
        return HarnessCheck {
            id: id.to_string(),
            command,
            installed: true,
            path: None,
        };
    }
    let resolver = if cfg!(windows) { "where" } else { "which" };
    let output = Command::new(resolver).arg(&command).output().ok();
    let path = output.and_then(|value| {
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
    let mut command = CommandBuilder::new(program);
    command.args(args);
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
        let code = child
            .lock()
            .ok()
            .and_then(|mut process| process.wait().ok())
            .map(|status| status.exit_code());
        let _ = exit_app.emit(
            "pty-exit",
            serde_json::json!({ "id": exit_id, "code": code }),
        );
        if let Ok(mut active) = exit_sessions.lock() {
            active.remove(&id);
        }
    });

    if let Some(input) = options.input.filter(|value| !value.trim().is_empty()) {
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
        "claude", "codex", "opencode", "gemini", "aider", "ollama", "shell",
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

fn main() {
    let app = tauri::Builder::default()
        .manage(BackendSupervisor::new())
        .manage(PtySupervisor::new())
        .plugin(tauri_plugin_dialog::init())
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
            app_version,
            get_workspace,
            list_projects,
            use_project,
            forget_project,
            choose_workspace,
            pick_workspace_location,
            create_workspace,
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
        if matches!(event, RunEvent::Exit) {
            stop_backend(&app_handle.state::<BackendSupervisor>());
        }
    });
}
