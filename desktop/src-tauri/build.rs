fn main() {
    // Tauri validates configured resources during `cargo check`, before the
    // release build's beforeBuildCommand has produced the PyInstaller binary.
    // Keep a generated placeholder for development/checks; release builds
    // replace it with the real executable.
    let backend =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../build/backend/contextgit-api");
    if !backend.exists() {
        if let Some(parent) = backend.parent() {
            std::fs::create_dir_all(parent).expect("create backend resource directory");
        }
        std::fs::write(&backend, b"development placeholder")
            .expect("create backend resource placeholder");
    }
    tauri_build::build();
}
