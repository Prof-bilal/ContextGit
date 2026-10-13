use serde::Serialize;
use std::{
    env, fs,
    io::{self, Read, Write},
    net::{TcpListener, TcpStream},
    path::Path,
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant, UNIX_EPOCH},
};
use tauri::{Manager, RunEvent};
use uuid::Uuid;

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
    api_token: String,
}

struct EditorSupervisor {
    child: Mutex<Option<Child>>,
    port: Mutex<Option<u16>>,
}

impl EditorSupervisor {
    fn new() -> Self {
        Self {
            child: Mutex::new(None),
            port: Mutex::new(None),
        }
    }
}

impl BackendSupervisor {
    fn new() -> Self {
        let port = env::var("CONTEXTGIT_PORT").unwrap_or_else(|_| "8756".to_string());
        Self {
            child: Mutex::new(None),
            api_base: format!("http://127.0.0.1:{port}"),
            api_token: Uuid::new_v4().to_string(),
        }
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
    command.env("CONTEXTGIT_API_TOKEN", api_token);
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
    let (mut command, _) = backend_command(
        &supervisor.api_base,
        resource_dir,
        data_dir,
        &supervisor.api_token,
    );
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
fn backend_token(supervisor: tauri::State<'_, BackendSupervisor>) -> String {
    supervisor.api_token.clone()
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

fn editor_binary(resource_dir: &Path) -> Option<std::path::PathBuf> {
    let configured = env::var_os("CONTEXTGIT_CODE_SERVER").map(std::path::PathBuf::from);
    let candidates = [
        configured,
        Some(
            resource_dir
                .join("editor")
                .join("bin")
                .join(if cfg!(windows) {
                    "code-server.exe"
                } else {
                    "code-server"
                }),
        ),
        Some(resource_dir.join("editor").join(if cfg!(windows) {
            "code-server.exe"
        } else {
            "code-server"
        })),
    ];
    candidates
        .into_iter()
        .flatten()
        .find(|candidate| candidate.is_file())
        .or_else(|| {
            ["code-server", "openvscode-server"]
                .into_iter()
                .find_map(|name| {
                    Command::new(if cfg!(windows) { "where" } else { "which" })
                        .arg(name)
                        .output()
                        .ok()
                        .filter(|output| output.status.success())
                        .and_then(|output| String::from_utf8(output.stdout).ok())
                        .and_then(|value| {
                            value
                                .lines()
                                .next()
                                .map(|line| std::path::PathBuf::from(line.trim()))
                        })
                })
        })
}

fn editor_healthy(port: u16) -> bool {
    let Ok(mut stream) = TcpStream::connect_timeout(
        &format!("127.0.0.1:{port}").parse().unwrap(),
        Duration::from_millis(250),
    ) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(250)));
    let _ =
        stream.write_all(b"GET /healthz HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
    let mut response = [0_u8; 256];
    let size = stream.read(&mut response).unwrap_or(0);
    String::from_utf8_lossy(&response[..size]).contains(" 200 ")
}

fn stop_editor(editor: &EditorSupervisor) {
    if let Ok(mut guard) = editor.child.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    if let Ok(mut port) = editor.port.lock() {
        *port = None;
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EditorStatus {
    state: String,
    url: Option<String>,
    message: Option<String>,
}

#[tauri::command]
fn editor_start(
    app: tauri::AppHandle,
    editor: tauri::State<'_, EditorSupervisor>,
    project: String,
) -> Result<EditorStatus, String> {
    if let (Ok(child), Ok(port)) = (editor.child.lock(), editor.port.lock()) {
        if child.is_some() && port.is_some() && editor_healthy(port.unwrap()) {
            return Ok(EditorStatus {
                state: "ready".to_string(),
                url: Some(format!(
                    "http://127.0.0.1:{}/?folder={}",
                    port.unwrap(),
                    urlencoding(&project)
                )),
                message: None,
            });
        }
    }
    stop_editor(&editor);
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?;
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let binary = editor_binary(&resource_dir).ok_or_else(|| "VS Code web runtime is not installed. Set CONTEXTGIT_CODE_SERVER or bundle the editor resource.".to_string())?;
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|error| error.to_string())?;
    let port = listener
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();
    drop(listener);
    let user_data = data_dir.join("editor");
    fs::create_dir_all(&user_data).map_err(|error| error.to_string())?;
    let is_openvscode = binary
        .file_name()
        .map(|name| name.to_string_lossy().contains("openvscode"))
        .unwrap_or(false);
    let mut command = Command::new(binary);
    let editor_token = Uuid::new_v4().to_string();
    if is_openvscode {
        command.args([
            "--host",
            "127.0.0.1",
            "--connection-token",
            &editor_token,
            "--port",
            &port.to_string(),
            "--user-data-dir",
        ]);
    } else {
        command.args([
            "--bind-addr",
            &format!("127.0.0.1:{port}"),
            "--auth",
            "password",
            "--disable-telemetry",
            "--user-data-dir",
        ]);
        command.env("PASSWORD", &editor_token);
    }
    command
        .arg(&user_data)
        .arg(&project)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let child = command
        .spawn()
        .map_err(|error| format!("VS Code web runtime could not start: {error}"))?;
    if let Ok(mut guard) = editor.child.lock() {
        *guard = Some(child);
    }
    if let Ok(mut current) = editor.port.lock() {
        *current = Some(port);
    }
    let deadline = Instant::now() + Duration::from_secs(15);
    while Instant::now() < deadline {
        if editor_healthy(port) {
            return Ok(EditorStatus {
                state: "ready".to_string(),
                url: Some(format!(
                    "http://127.0.0.1:{port}/?folder={}",
                    urlencoding(&project)
                )),
                message: None,
            });
        }
        thread::sleep(Duration::from_millis(150));
    }
    stop_editor(&editor);
    Err("VS Code web runtime did not become ready".to_string())
}

#[tauri::command]
fn editor_status(editor: tauri::State<'_, EditorSupervisor>) -> EditorStatus {
    let port = editor.port.lock().ok().and_then(|value| *value);
    if let Some(port) = port.filter(|port| editor_healthy(*port)) {
        EditorStatus {
            state: "ready".to_string(),
            url: Some(format!("http://127.0.0.1:{port}")),
            message: None,
        }
    } else {
        EditorStatus {
            state: "stopped".to_string(),
            url: None,
            message: None,
        }
    }
}

#[tauri::command]
fn editor_stop(editor: tauri::State<'_, EditorSupervisor>) {
    stop_editor(&editor);
}

fn urlencoding(value: &str) -> String {
    value
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (byte as char).to_string()
            }
            other => format!("%{other:02X}"),
        })
        .collect()
}

const MAX_EDITOR_FILE_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileNode {
    name: String,
    path: String,
    kind: String,
    size: Option<u64>,
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

fn project_file_path(
    project: &str,
    relative: &str,
    allow_missing: bool,
) -> Result<(std::path::PathBuf, std::path::PathBuf), String> {
    let root =
        fs::canonicalize(project).map_err(|error| format!("Project is unavailable: {error}"))?;
    let target = root.join(relative);
    let checked = if target.exists() {
        fs::canonicalize(&target).map_err(|error| format!("Path is unavailable: {error}"))?
    } else if allow_missing {
        let parent = target
            .parent()
            .ok_or_else(|| "Invalid project path".to_string())?;
        let canonical_parent = fs::canonicalize(parent)
            .map_err(|error| format!("Parent folder is unavailable: {error}"))?;
        let missing = target
            .file_name()
            .ok_or_else(|| "Invalid file path".to_string())?;
        canonical_parent.join(missing)
    } else {
        return Err("Path is unavailable".to_string());
    };
    if checked != root && !checked.starts_with(&root) {
        return Err("Path must stay inside the selected project".to_string());
    }
    Ok((root, checked))
}

fn document_version(metadata: &fs::Metadata) -> String {
    let modified = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_millis())
        .unwrap_or(0);
    format!("{}:{modified}", metadata.len())
}

fn read_document(project: &str, relative: &str) -> Result<FileDocument, String> {
    let (_root, target) = project_file_path(project, relative, false)?;
    let metadata = fs::metadata(&target).map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err("Only files can be opened".to_string());
    }
    if metadata.len() > MAX_EDITOR_FILE_BYTES {
        return Err("File is too large to open in the editor".to_string());
    }
    let content = fs::read_to_string(&target).map_err(|_| "File is not valid UTF-8".to_string())?;
    Ok(FileDocument {
        path: relative.replace('\\', "/"),
        content,
        version: document_version(&metadata),
        size: metadata.len(),
        encoding: "utf8".to_string(),
    })
}

#[tauri::command]
fn files_list(project: String, relative: Option<String>) -> Result<Vec<FileNode>, String> {
    let relative = relative.unwrap_or_else(|| ".".to_string());
    let (_root, directory) = project_file_path(&project, &relative, false)?;
    if !directory.is_dir() {
        return Err("Not a directory".to_string());
    }
    let ignored = [
        ".git",
        "node_modules",
        ".contextgit",
        "dist",
        "build",
        ".next",
    ];
    let mut result = Vec::new();
    for entry in fs::read_dir(&directory).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if ignored.contains(&name.as_str()) {
            continue;
        }
        let metadata = fs::symlink_metadata(entry.path()).map_err(|error| error.to_string())?;
        let child = if relative == "." {
            name.clone()
        } else {
            format!("{relative}/{name}")
        };
        result.push(FileNode {
            name,
            path: child,
            kind: if metadata.is_dir() {
                "directory"
            } else {
                "file"
            }
            .to_string(),
            size: metadata.is_file().then_some(metadata.len()),
        });
    }
    result.sort_by(|a, b| {
        b.kind
            .cmp(&a.kind)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(result)
}

#[tauri::command]
fn file_read(project: String, relative: String) -> Result<FileDocument, String> {
    read_document(&project, &relative)
}

#[tauri::command]
fn file_write(
    project: String,
    relative: String,
    content: String,
    expected_version: Option<String>,
) -> Result<FileDocument, String> {
    if content.as_bytes().len() as u64 > MAX_EDITOR_FILE_BYTES {
        return Err("File is too large to save".to_string());
    }
    let (_root, target) = project_file_path(&project, &relative, true)?;
    if target.exists() {
        let metadata = fs::metadata(&target).map_err(|error| error.to_string())?;
        if !metadata.is_file() {
            return Err("Only files can be saved".to_string());
        }
        if expected_version
            .as_deref()
            .is_some_and(|version| version != document_version(&metadata))
        {
            return Err("File changed on disk; reload before saving".to_string());
        }
    }
    let temporary = target.with_extension(format!("contextgit-{}.tmp", std::process::id()));
    fs::write(&temporary, content.as_bytes()).map_err(|error| error.to_string())?;
    fs::rename(&temporary, &target).map_err(|error| error.to_string())?;
    read_document(&project, &relative)
}

fn main() {
    let app = tauri::Builder::default()
        .manage(BackendSupervisor::new())
        .manage(EditorSupervisor::new())
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
            backend_token,
            restart_backend,
            app_version,
            editor_start,
            editor_status,
            editor_stop,
            files_list,
            file_read,
            file_write
        ])
        .build(tauri::generate_context!())
        .expect("error while building ContextGit Tauri application");
    app.run(|app_handle, event| {
        if matches!(event, RunEvent::Exit) {
            stop_backend(&app_handle.state::<BackendSupervisor>());
            stop_editor(&app_handle.state::<EditorSupervisor>());
        }
    });
}
