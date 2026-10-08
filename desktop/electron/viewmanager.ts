/**
 * The in-app browser: a pool of `WebContentsView`s owned by the main process.
 * A view is not a DOM element — the renderer reports the placeholder's bounds
 * and this positions the native view over it.
 *
 * This is a general browser: any http(s) page loads. The content stays safe
 * because it runs sandboxed, without Node or the app's preload, in its own
 * session partition, and powerful permissions (camera, mic, location, …) are
 * denied by default.
 */
import { type BrowserWindow, WebContentsView, shell } from "electron";

import type { ViewBounds, ViewCreateResult, ViewEvent } from "../shared/browser";

/** Only http(s) pages open here; file:, javascript:, … are refused. */
function isNavigable(target: string): boolean {
  try {
    const parsed = new URL(target);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/** Permissions a web page may not silently take from the desktop app. */
const BLOCKED_PERMISSIONS = new Set([
  "media",
  "geolocation",
  "notifications",
  "midi",
  "midiSysex",
  "hid",
  "serial",
  "usb",
  "bluetooth",
  "idle-detection",
  "window-management",
  "local-fonts",
]);

export class ViewManager {
  private readonly views = new Map<string, WebContentsView>();

  constructor(
    private readonly window: () => BrowserWindow | null,
    private readonly send: (event: ViewEvent) => void,
  ) {}

  private emit(event: ViewEvent): void {
    this.send(event);
  }

  create(id: string, url: string): ViewCreateResult {
    if (!isNavigable(url)) {
      return { ok: false, error: "Only http(s) pages can be opened here." };
    }
    const win = this.window();
    if (!win) return { ok: false, error: "No window" };
    this.destroy(id);

    const view = new WebContentsView({
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        partition: "persist:browser",
      },
    });
    const contents = view.webContents;
    // Popups (OAuth, target=_blank) become a new in-app tab; anything that is
    // not a web page goes to the OS instead.
    contents.setWindowOpenHandler(({ url: target }) => {
      if (isNavigable(target)) this.emit({ id, type: "open", url: target });
      else if (/^(mailto|tel):/i.test(target)) void shell.openExternal(target);
      return { action: "deny" };
    });
    contents.session.setPermissionRequestHandler((_contents, permission, callback) => {
      callback(!BLOCKED_PERMISSIONS.has(permission));
    });
    contents.on("will-navigate", (event, target) => {
      if (!isNavigable(target)) {
        event.preventDefault();
        this.emit({ id, type: "blocked", url: target });
      }
    });
    contents.on("did-start-loading", () => this.emit({ id, type: "loading" }));
    contents.on("did-stop-loading", () =>
      this.emit({ id, type: "loaded", url: contents.getURL(), title: contents.getTitle() }),
    );
    contents.on("did-navigate", (_event, target) => this.emit({ id, type: "navigate", url: target }));
    contents.on("did-navigate-in-page", (_event, target) =>
      this.emit({ id, type: "navigate", url: target }),
    );
    contents.on("page-title-updated", (_event, title) => this.emit({ id, type: "title", title }));
    contents.on("found-in-page", (_event, result) =>
      this.emit({ id, type: "found", matches: result.matches, active: result.activeMatchOrdinal }),
    );
    contents.on("did-fail-load", (_event, code, description, target, isMainFrame) => {
      if (isMainFrame) this.emit({ id, type: "error", url: target, error: `${description} (${code})` });
    });

    win.contentView.addChildView(view);
    view.setVisible(false);
    this.views.set(id, view);
    void contents.loadURL(url);
    return { ok: true };
  }

  setBounds(id: string, bounds: ViewBounds): void {
    const view = this.views.get(id);
    if (!view) return;
    view.setBounds({
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.max(0, Math.round(bounds.width)),
      height: Math.max(0, Math.round(bounds.height)),
    });
  }

  setVisible(id: string, visible: boolean): void {
    this.views.get(id)?.setVisible(visible);
  }

  load(id: string, url: string): ViewCreateResult {
    const view = this.views.get(id);
    if (!view) return { ok: false, error: "No view" };
    if (!isNavigable(url)) return { ok: false, error: "Only http(s) pages can be opened here." };
    void view.webContents.loadURL(url);
    return { ok: true };
  }

  back(id: string): void {
    const contents = this.views.get(id)?.webContents;
    if (contents?.navigationHistory.canGoBack()) contents.navigationHistory.goBack();
  }

  forward(id: string): void {
    const contents = this.views.get(id)?.webContents;
    if (contents?.navigationHistory.canGoForward()) contents.navigationHistory.goForward();
  }

  reload(id: string): void {
    this.views.get(id)?.webContents.reload();
  }

  devtools(id: string): void {
    const contents = this.views.get(id)?.webContents;
    if (!contents) return;
    if (contents.isDevToolsOpened()) contents.closeDevTools();
    else contents.openDevTools({ mode: "detach" });
  }

  /** Find text in the page; results arrive as `found` events. */
  find(id: string, text: string): void {
    const contents = this.views.get(id)?.webContents;
    if (!contents) return;
    if (!text) {
      contents.stopFindInPage("clearSelection");
      return;
    }
    contents.findInPage(text);
  }

  stopFind(id: string): void {
    this.views.get(id)?.webContents.stopFindInPage("clearSelection");
  }

  setZoom(id: string, level: number): void {
    this.views.get(id)?.webContents.setZoomLevel(level);
  }

  destroy(id: string): void {
    const view = this.views.get(id);
    if (!view) return;
    this.views.delete(id);
    try {
      this.window()?.contentView.removeChildView(view);
      view.webContents.close();
    } catch {
      // the window may already be gone
    }
  }

  destroyAll(): void {
    for (const id of [...this.views.keys()]) this.destroy(id);
  }
}
