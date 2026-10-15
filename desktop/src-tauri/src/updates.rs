use serde::{Deserialize, Serialize};
use std::{sync::Mutex, time::Duration};
use tauri::{Emitter, Manager};

const RELEASES: &str = "https://github.com/Prof-bilal/ContextGit/releases";
const API: &str = "https://api.github.com/repos/Prof-bilal/ContextGit/releases?per_page=100";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    state: String,
    current_version: String,
    version: Option<String>,
    release_url: String,
    message: Option<String>,
    manual: bool,
    supported: bool,
}

impl Default for UpdateStatus {
    fn default() -> Self {
        Self { state: "idle".into(), current_version: env!("CARGO_PKG_VERSION").into(), version: None,
            release_url: RELEASES.into(), message: None, manual: true, supported: false }
    }
}

#[derive(Default)]
pub struct UpdateService(Mutex<UpdateStatus>);

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    html_url: String,
    draft: bool,
    prerelease: bool,
    assets: Vec<Asset>,
}

#[derive(Deserialize)]
struct Asset { name: String }

fn has_installer(release: &Release) -> bool {
    release.assets.iter().any(|asset| [".appimage", ".exe", ".msi", ".dmg", ".deb", ".rpm", ".pacman", ".tar.gz", ".zip"]
        .iter().any(|suffix| asset.name.to_ascii_lowercase().ends_with(suffix)))
}

fn valid_release_url(value: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(value) else { return false; };
    url.scheme() == "https" && url.host_str() == Some("github.com") && url.port().is_none()
        && url.username().is_empty() && url.password().is_none()
        && (url.path() == "/Prof-bilal/ContextGit/releases" || url.path().starts_with("/Prof-bilal/ContextGit/releases/tag/"))
}

fn select_release(releases: &[Release], current: &str) -> Result<UpdateStatus, String> {
    let current_version = semver::Version::parse(current).map_err(|_| "The installed app version is invalid")?;
    let latest = releases.iter().filter(|release| !release.draft && has_installer(release))
        .filter_map(|release| semver::Version::parse(release.tag_name.trim_start_matches('v')).ok().map(|version| (release, version)))
        .filter(|(release, version)| !current_version.pre.is_empty() || (!release.prerelease && version.pre.is_empty()))
        .max_by(|(_, left), (_, right)| left.cmp(right));
    let mut status = UpdateStatus { current_version: current.into(), ..Default::default() };
    let no_release = latest.is_none();
    if let Some((release, version)) = latest.filter(|(_, version)| version > &current_version) {
        if !valid_release_url(&release.html_url) { return Err("GitHub returned an invalid release URL".into()); }
        status.state = "available".into();
        status.version = Some(version.to_string());
        status.release_url = release.html_url.clone();
        status.message = Some("Download the installer for your operating system and architecture, then install it manually. Automatic installation is not configured for this beta.".into());
    } else {
        status.state = "up-to-date".into();
        status.message = Some(if no_release { "No published installer newer than this version was found." } else { "You are using the latest available version." }.into());
    }
    Ok(status)
}

async fn fetch_release(current: &str) -> Result<UpdateStatus, String> {
    let client = reqwest::Client::builder().timeout(Duration::from_secs(20)).connect_timeout(Duration::from_secs(8))
        .https_only(true).redirect(reqwest::redirect::Policy::none())
        .user_agent(format!("ContextGit/{current}"))
        .build().map_err(|error| format!("Could not initialize the update check: {error}"))?;
    let mut response = client.get(API).header("Accept", "application/vnd.github+json").header("X-GitHub-Api-Version", "2022-11-28")
        .send().await.map_err(|error| format!("Could not reach GitHub. Check your connection and retry: {error}"))?;
    if !response.status().is_success() {
        return Err(match response.status().as_u16() {
            403 | 429 => "GitHub's update-check rate limit was reached. Please retry later or open release downloads.".into(),
            code => format!("GitHub update check failed (HTTP {code}). Please retry later."),
        });
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|error| format!("Could not read GitHub's response: {error}"))? {
        if bytes.len() + chunk.len() > 8 * 1024 * 1024 { return Err("GitHub's update response was too large".into()); }
        bytes.extend_from_slice(&chunk);
    }
    let releases = serde_json::from_slice::<Vec<Release>>(&bytes).map_err(|_| "GitHub returned invalid release metadata")?;
    select_release(&releases, current)
}

fn publish(app: &tauri::AppHandle, status: UpdateStatus) -> Result<UpdateStatus, String> {
    *app.state::<UpdateService>().0.lock().map_err(|_| "Update state is unavailable")? = status.clone();
    let _ = app.emit("update-status", &status);
    Ok(status)
}

#[tauri::command]
pub async fn check_for_updates(app: tauri::AppHandle) -> Result<UpdateStatus, String> {
    let checking = {
        let service = app.state::<UpdateService>();
        let mut status = service.0.lock().map_err(|_| "Update state is unavailable")?;
        if status.state == "checking" { return Ok(status.clone()); }
        status.state = "checking".into(); status.message = None;
        status.clone()
    };
    let _ = app.emit("update-status", &checking);
    let status = fetch_release(&checking.current_version).await.unwrap_or_else(|message| UpdateStatus {
        state: "error".into(), message: Some(message), ..checking
    });
    publish(&app, status)
}

#[tauri::command]
pub async fn open_update_release(app: tauri::AppHandle) -> Result<(), String> {
    let url = app.state::<UpdateService>().0.lock().map_err(|_| "Update state is unavailable")?.release_url.clone();
    if !valid_release_url(&url) { return Err("Invalid update release URL".into()); }
    super::browser_open_external(url).await
}

#[tauri::command]
pub async fn download_update(app: tauri::AppHandle) -> Result<UpdateStatus, String> {
    open_update_release(app.clone()).await?;
    let status = app.state::<UpdateService>().0.lock().map_err(|_| "Update state is unavailable")?.clone();
    Ok(status)
}

#[tauri::command]
pub fn install_update() -> Result<UpdateStatus, String> {
    Err("Automatic installation is not configured for this beta. Open release downloads and install the matching package manually.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "requires access to GitHub's public release API"]
    fn github_release_metadata_smoke() {
        let status = tauri::async_runtime::block_on(fetch_release(env!("CARGO_PKG_VERSION"))).unwrap();
        assert!(matches!(status.state.as_str(), "available" | "up-to-date"));
        assert!(valid_release_url(&status.release_url));
        println!("GitHub release check: {} (installed {})", status.state, status.current_version);
    }
    fn release(version: &str) -> Release {
        Release { tag_name: format!("v{version}"), html_url: format!("{RELEASES}/tag/v{version}"), draft: false,
            prerelease: version.contains('-'), assets: vec![Asset { name: "ContextGit.AppImage".into() }] }
    }
    #[test]
    fn beta_checks_include_prereleases_and_sort_semantically() {
        let releases = vec![release("0.2.0-beta.9"), release("0.2.0-beta.10"), release("0.1.0")];
        let status = select_release(&releases, "0.2.0-beta.3").unwrap();
        assert_eq!(status.version.as_deref(), Some("0.2.0-beta.10"));
        assert!(!status.supported);
        assert_eq!(select_release(&releases, "0.2.0-beta.10").unwrap().state, "up-to-date");
    }
    #[test]
    fn stable_does_not_upgrade_to_beta_and_drafts_or_empty_releases_are_skipped() {
        let mut draft = release("5.0.0"); draft.draft = true;
        let mut empty = release("4.0.0"); empty.assets = vec![Asset { name: "SHA256SUMS".into() }];
        let releases = vec![draft, empty, release("3.0.0-beta.1"), release("1.0.1")];
        assert_eq!(select_release(&releases, "1.0.0").unwrap().version.as_deref(), Some("1.0.1"));
    }
    #[test]
    fn release_destinations_cannot_escape_the_project() {
        for url in ["http://github.com/Prof-bilal/ContextGit/releases", "https://github.com.evil.test/Prof-bilal/ContextGit/releases", "https://evil@github.com/Prof-bilal/ContextGit/releases", "file:///tmp/install", "https://github.com/other/repo/releases"] {
            assert!(!valid_release_url(url));
        }
        let mut malicious = release("1.0.0"); malicious.html_url = "https://evil.test".into();
        assert!(select_release(&[malicious], "0.1.0").is_err());
    }
}
