//! Local-only transcription. Network access is used solely for the fixed model download.
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{fs, io::{Read, Write}, path::PathBuf, process::{Command, Stdio}, sync::{atomic::{AtomicBool, Ordering}, Mutex}, time::Duration};
use tauri::{Emitter, Manager};

const MODEL_SHA: &str = "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe";
const MODEL_SIZE: u64 = 147951465;
const MODEL_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin";

#[derive(Default)]
pub struct VoiceState { busy: AtomicBool, cancel: AtomicBool, verified: Mutex<Option<std::time::SystemTime>> }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceStatus { model_ready: bool, sidecar_ready: bool, busy: bool, model_bytes: u64, version: String }

fn directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let path = app.path().app_data_dir().map_err(|e| e.to_string())?.join("voice");
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(path)
}
fn sidecar(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let name = if cfg!(windows) { "whisper-cli.exe" } else { "whisper-cli" };
    let bundled = app.path().resource_dir().map_err(|e| e.to_string())?.join("voice").join(name);
    if bundled.is_file() { return Ok(bundled); }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../build/voice").join(name);
    if dev.is_file() { return Ok(dev); }
    Err("The bundled Whisper engine is missing. Run npm run build:voice and rebuild the desktop app.".into())
}
fn checksum(path: &std::path::Path) -> Result<bool, String> {
    let mut reader = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hash = Sha256::new(); let mut buffer = [0u8; 65536];
    loop { let n = reader.read(&mut buffer).map_err(|e| e.to_string())?; if n == 0 { break; } hash.update(&buffer[..n]); }
    Ok(format!("{:x}", hash.finalize()) == MODEL_SHA)
}
fn verified(app: &tauri::AppHandle) -> bool {
    let Ok(folder) = directory(app) else { return false; };
    let path = folder.join("ggml-base.bin");
    let Ok(metadata) = path.metadata() else { return false; };
    if metadata.len() != MODEL_SIZE { return false; }
    let state = app.state::<VoiceState>();
    let modified = metadata.modified().ok();
    let mut last = state.verified.lock().unwrap();
    if modified.is_some() && *last == modified { return true; }
    if checksum(&path).unwrap_or(false) { *last = modified; true } else { false }
}

fn valid_wav(wav: &[u8]) -> bool {
    wav.len() >= 44 && wav.len() <= 20_000_000 && &wav[0..4] == b"RIFF"
        && &wav[8..12] == b"WAVE" && &wav[12..16] == b"fmt "
        && u16::from_le_bytes([wav[20], wav[21]]) == 1
        && u16::from_le_bytes([wav[22], wav[23]]) == 1
        && u32::from_le_bytes([wav[24], wav[25], wav[26], wav[27]]) == 16000
        && u16::from_le_bytes([wav[34], wav[35]]) == 16
        && &wav[36..40] == b"data"
}

#[tauri::command]
pub async fn voice_model_status(app: tauri::AppHandle) -> Result<VoiceStatus, String> {
    tauri::async_runtime::spawn_blocking(move || Ok(VoiceStatus { model_ready: verified(&app), sidecar_ready: sidecar(&app).is_ok(), busy: app.state::<VoiceState>().busy.load(Ordering::SeqCst), model_bytes: MODEL_SIZE, version: "whisper.cpp v1.7.6 / multilingual base".into() })).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn voice_model_download(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<VoiceState>();
    if state.busy.swap(true, Ordering::SeqCst) { return Err("Voice service is busy".into()); }
    state.cancel.store(false, Ordering::SeqCst);
    let result = async {
        let folder = directory(&app)?; let temporary = folder.join("ggml-base.download");
        let mut target = fs::File::create(&temporary).map_err(|e| e.to_string())?;
        let client = reqwest::Client::builder().timeout(Duration::from_secs(900)).build().map_err(|e| e.to_string())?;
        let mut response = client.get(MODEL_URL).send().await.map_err(|e| e.to_string())?.error_for_status().map_err(|e| e.to_string())?;
        let mut hash = Sha256::new(); let mut bytes: u64 = 0;
        while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
            if state.cancel.load(Ordering::SeqCst) { return Err("Download cancelled".into()); }
            bytes += chunk.len() as u64;
            if bytes > MODEL_SIZE { return Err("Model exceeds expected size".into()); }
            hash.update(&chunk); target.write_all(&chunk).map_err(|e| e.to_string())?;
            let _ = app.emit("voice-progress", serde_json::json!({ "bytes": bytes, "total": MODEL_SIZE }));
        }
        if bytes != MODEL_SIZE || format!("{:x}", hash.finalize()) != MODEL_SHA { return Err("Model checksum failed. Retry the download.".into()); }
        target.sync_all().map_err(|e| e.to_string())?; drop(target);
        if state.cancel.load(Ordering::SeqCst) { return Err("Download cancelled".into()); }
        let destination = folder.join("ggml-base.bin");
        if destination.exists() { fs::remove_file(&destination).map_err(|e| e.to_string())?; }
        fs::rename(&temporary, destination).map_err(|e| e.to_string())?;
        Ok(())
    }.await;
    if let Ok(folder) = directory(&app) { let _ = fs::remove_file(folder.join("ggml-base.download")); }
    state.busy.store(false, Ordering::SeqCst);
    result
}

#[tauri::command]
pub fn voice_cancel(app: tauri::AppHandle) { app.state::<VoiceState>().cancel.store(true, Ordering::SeqCst); }

#[tauri::command]
pub fn voice_model_remove(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<VoiceState>();
    if state.busy.load(Ordering::SeqCst) { return Err("Cancel the active voice operation first".into()); }
    let path = directory(&app)?.join("ggml-base.bin");
    if path.exists() { fs::remove_file(path).map_err(|e| e.to_string())?; }
    *state.verified.lock().unwrap() = None;
    Ok(())
}

#[tauri::command]
pub async fn voice_transcribe(app: tauri::AppHandle, wav: Vec<u8>) -> Result<String, String> {
    if !valid_wav(&wav) { return Err("Record a mono 16 kHz PCM WAV file under five minutes".into()); }
    if app.state::<VoiceState>().busy.swap(true, Ordering::SeqCst) { return Err("Voice service is busy".into()); }
    app.state::<VoiceState>().cancel.store(false, Ordering::SeqCst);
    let cleanup_app = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        if !verified(&app) { return Err("The voice model is missing or corrupt. Download it again.".into()); }
        let engine = sidecar(&app)?;
        let folder = directory(&app)?;
        let stem = folder.join(format!("recording-{}", uuid::Uuid::new_v4()));
        let audio = stem.with_extension("wav"); let text = stem.with_extension("txt");
        let result = (|| {
            fs::write(&audio, wav).map_err(|e| e.to_string())?;
            let mut child = Command::new(engine).arg("-m").arg(folder.join("ggml-base.bin")).arg("-f").arg(&audio)
                .args(["-l", "auto", "-otxt", "-nt", "-np", "-of"]).arg(&stem)
                .stdout(Stdio::null()).stderr(Stdio::null()).spawn().map_err(|e| e.to_string())?;
            let start = std::time::Instant::now();
            loop {
                if app.state::<VoiceState>().cancel.load(Ordering::SeqCst) || start.elapsed() > Duration::from_secs(180) {
                    let _ = child.kill(); let _ = child.wait(); return Err("Transcription cancelled or timed out".into());
                }
                if let Some(exit) = child.try_wait().map_err(|e| e.to_string())? { if !exit.success() { return Err("Whisper could not transcribe this recording".into()); } break; }
                std::thread::sleep(Duration::from_millis(40));
            }
            let transcript = fs::read_to_string(&text).map_err(|e| e.to_string())?.trim().to_string();
            if transcript.is_empty() || transcript == "[BLANK_AUDIO]" { return Err("No speech detected. Try recording again.".into()); }
            Ok(transcript)
        })();
        let _ = fs::remove_file(audio); let _ = fs::remove_file(text);
        result
    }).await.map_err(|e| e.to_string());
    cleanup_app.state::<VoiceState>().busy.store(false, Ordering::SeqCst);
    result?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_bad_audio_and_corrupt_models() {
        assert!(!valid_wav(&[]));
        assert!(!valid_wav(&[0; 44]));
        let mut wav = vec![0u8; 48];
        wav[0..4].copy_from_slice(b"RIFF"); wav[8..12].copy_from_slice(b"WAVE");
        wav[12..16].copy_from_slice(b"fmt "); wav[20..22].copy_from_slice(&1u16.to_le_bytes());
        wav[22..24].copy_from_slice(&1u16.to_le_bytes()); wav[24..28].copy_from_slice(&16000u32.to_le_bytes());
        wav[34..36].copy_from_slice(&16u16.to_le_bytes()); wav[36..40].copy_from_slice(b"data");
        assert!(valid_wav(&wav)); wav[22] = 2; assert!(!valid_wav(&wav));
        let path = std::env::temp_dir().join(format!("contextgit-model-test-{}", uuid::Uuid::new_v4()));
        fs::write(&path, b"corrupt model").unwrap();
        assert!(!checksum(&path).unwrap()); fs::remove_file(&path).unwrap();
    }
}
