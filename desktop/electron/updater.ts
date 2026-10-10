import { autoUpdater } from "electron-updater";

import {
  compareVersions,
  isBetaVersion,
  isLinuxPackageManagerInstall,
  UPDATE_RELEASE_URL,
  type UpdateStatus,
} from "../shared/update";

type PublishStatus = (status: UpdateStatus) => void;

const CHECK_COOLDOWN_MS = 6 * 60 * 60 * 1000;

export class ContextGitUpdater {
  private readonly currentVersion: string;
  private readonly packaged: boolean;
  private readonly statusSink: PublishStatus;
  private status: UpdateStatus;
  private lastCheck = 0;
  private checkPromise: Promise<UpdateStatus> | null = null;
  private downloadPromise: Promise<UpdateStatus> | null = null;
  private activeManualCheck = false;

  constructor(options: { currentVersion: string; packaged: boolean; statusSink: PublishStatus }) {
    this.currentVersion = options.currentVersion;
    this.packaged = options.packaged;
    this.statusSink = options.statusSink;
    this.status = { state: "idle", currentVersion: this.currentVersion };
  }

  getStatus(): UpdateStatus {
    return this.status;
  }

  initialize(): void {
    if (!this.packaged) return;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowPrerelease = isBetaVersion(this.currentVersion);
    autoUpdater.on("checking-for-update", () => this.publish({ state: "checking" }));
    autoUpdater.on("update-available", info => this.publish({ state: "available", version: info.version, supported: true }));
    autoUpdater.on("update-not-available", () => this.publish({ state: "up-to-date", manual: false }));
    autoUpdater.on("download-progress", progress => this.publish({ state: "downloading", percent: Math.round(progress.percent), supported: true }));
    autoUpdater.on("update-downloaded", info => this.publish({ state: "downloaded", version: info.version, supported: true }));
    autoUpdater.on("error", error => {
      const message = error instanceof Error ? error.message : "Update check failed.";
      if (process.platform === "darwin") {
        this.publish({ state: "error", message: "Native install is unavailable for this unsigned macOS build.", manual: this.activeManualCheck, supported: false, releaseUrl: UPDATE_RELEASE_URL });
      } else {
        this.publish({ state: "error", message, manual: this.activeManualCheck, supported: false, releaseUrl: UPDATE_RELEASE_URL });
      }
    });
  }

  async check(manual = false): Promise<UpdateStatus> {
    if (!this.packaged) return this.status;
    if (!manual && Date.now() - this.lastCheck < CHECK_COOLDOWN_MS) return this.status;
    if (this.checkPromise) return this.checkPromise;
    this.lastCheck = Date.now();
    this.checkPromise = isLinuxPackageManagerInstall(process.platform, process.env.APPIMAGE)
      ? this.checkReleaseApi(manual)
      : this.checkNative(manual);
    try {
      return await this.checkPromise;
    } finally {
      this.checkPromise = null;
    }
  }

  async download(): Promise<UpdateStatus> {
    if (!this.packaged || !this.status.version || !this.status.supported) return this.status;
    if (this.downloadPromise) return this.downloadPromise;
    this.downloadPromise = autoUpdater.downloadUpdate().then(() => this.status).catch(error => {
      const message = error instanceof Error ? error.message : "Could not download the update.";
      return this.publish({ state: "error", message, manual: true, supported: true });
    });
    try {
      return await this.downloadPromise;
    } finally {
      this.downloadPromise = null;
    }
  }

  install(): UpdateStatus {
    if (this.status.state === "downloaded" && this.status.supported) {
      autoUpdater.quitAndInstall(false, true);
    }
    return this.status;
  }

  private publish(next: Partial<UpdateStatus>): UpdateStatus {
    this.status = { ...this.status, ...next, currentVersion: this.currentVersion };
    this.statusSink(this.status);
    return this.status;
  }

  private async checkNative(manual: boolean): Promise<UpdateStatus> {
    this.activeManualCheck = manual;
    this.publish({ state: "checking", manual });
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Update check failed.";
      this.activeManualCheck = false;
      return this.publish({ state: "error", message, manual, supported: false, releaseUrl: UPDATE_RELEASE_URL });
    }
    this.activeManualCheck = false;
    return this.status;
  }

  private async checkReleaseApi(manual: boolean): Promise<UpdateStatus> {
    this.publish({ state: "checking", manual });
    try {
      const response = await fetch("https://api.github.com/repos/Prof-bilal/ContextGit/releases?per_page=20", {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "ContextGit-updater" },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
      const releases = await response.json() as Array<{ tag_name?: string; prerelease?: boolean; html_url?: string }>;
      const release = releases.find(item => Boolean(item.tag_name) && (isBetaVersion(this.currentVersion) ? item.prerelease === true : item.prerelease !== true));
      const version = release?.tag_name?.replace(/^v/, "");
      if (!version || compareVersions(version, this.currentVersion) <= 0) return this.publish({ state: "up-to-date", manual });
      return this.publish({ state: "available", version, manual, supported: false, releaseUrl: release?.html_url ?? UPDATE_RELEASE_URL });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not reach GitHub.";
      return this.publish({ state: "error", message, manual, supported: false, releaseUrl: UPDATE_RELEASE_URL });
    }
  }
}
