import type { UpdateStatus } from "../shared/update";

type Invoke = (command: string) => Promise<unknown>;
type Listen = (name: string, callback: (event: { payload: unknown }) => void) => Promise<() => void>;

/** Update state is shared by the titlebar and banner; there is no polling. */
export function createUpdateBridge(invoke: Invoke, listen: Listen | undefined, currentVersion: string) {
  let status: UpdateStatus = { state: "idle", currentVersion, supported: false };
  const listeners = new Set<(status: UpdateStatus) => void>();
  let check: Promise<UpdateStatus> | null = null;
  let opening: Promise<void> | null = null;
  const publish = (next: UpdateStatus) => {
    status = next;
    listeners.forEach(listener => listener(status));
    return status;
  };
  const failure = (cause: unknown) => publish({ ...status, state: "error", manual: true, message: cause instanceof Error ? cause.message : String(cause) });
  void listen?.("update-status", event => publish(event.payload as UpdateStatus)).catch(failure);
  const action = async (command: string) => {
    try { return publish(await invoke(command) as UpdateStatus); }
    catch (cause) { return failure(cause); }
  };
  return {
    getUpdateStatus: () => status,
    onUpdateStatus(callback: (next: UpdateStatus) => void) {
      listeners.add(callback); callback(status);
      return () => { listeners.delete(callback); };
    },
    checkForUpdates() {
      if (!check) {
        publish({ ...status, state: "checking", manual: true, message: undefined });
        check = action("check_for_updates").finally(() => { check = null; });
      }
      return check;
    },
    downloadUpdate: () => action("download_update"),
    installUpdate: () => action("install_update"),
    openUpdateRelease() {
      if (!opening) opening = invoke("open_update_release").then(() => {}).catch(cause => {
        failure(cause); throw cause;
      }).finally(() => { opening = null; });
      return opening;
    },
  };
}
