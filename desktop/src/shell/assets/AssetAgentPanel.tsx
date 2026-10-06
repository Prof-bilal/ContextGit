import { useCallback, useEffect, useState } from "react";

import { api, type ProviderInfo } from "@/lib/api";
import type { AgentAction, Asset } from "../../../shared/assets";
import AddProviderDialog from "../chat/AddProviderDialog";
import Modal from "../Modal";

const PROVIDER_KEY = "cg-asset-agent-provider";
const MODEL_KEY = "cg-asset-agent-model";

function describe(action: AgentAction, nameOf: (id: string) => string): string {
  switch (action.type) {
    case "create_folder":
      return `Create folder “${action.path}”`;
    case "move":
      return `Move ${action.ids.length} item(s) → “${action.folder || "(root)"}”`;
    case "rename":
      return `Rename “${nameOf(action.id)}” → “${action.name}”`;
    case "tag":
      return `Tag “${nameOf(action.id)}” with ${action.tags.join(", ") || "—"}`;
    case "note":
      return `Add a note to “${nameOf(action.id)}”`;
    case "delete":
      return `Delete ${action.ids.map(nameOf).join(", ")}`;
  }
}

/**
 * The asset agent. Its providers are a separate store from Chat's (see the
 * `/agent-providers` API), so the two never conflict. Non-destructive actions
 * apply immediately; deletes wait for a confirmation.
 */
export default function AssetAgentPanel({
  assets,
  onChanged,
  onClose,
}: {
  assets: Asset[];
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [providerId, setProviderId] = useState(() => window.localStorage.getItem(PROVIDER_KEY) ?? "");
  const [model, setModel] = useState(() => window.localStorage.getItem(MODEL_KEY) ?? "");
  const [connectOpen, setConnectOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [pendingDeletes, setPendingDeletes] = useState<AgentAction[] | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await api.agentProviders();
      setProviders(list);
      setProviderId((current) => current || list.find((entry) => entry.has_key)?.id || "");
    } catch {
      // the registry may not be ready yet; the dialog still opens
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    window.localStorage.setItem(PROVIDER_KEY, providerId);
  }, [providerId]);
  useEffect(() => {
    window.localStorage.setItem(MODEL_KEY, model);
  }, [model]);

  const nameOf = (id: string) => assets.find((asset) => asset.id === id)?.name ?? id.slice(0, 6);
  const selected = providers.find((entry) => entry.id === providerId) ?? null;
  const record = (lines: string[]) => setLog((current) => [...current, ...lines]);
  const format = (results: { ok: boolean; action: AgentAction; error?: string }[]) =>
    results.map(
      (result) =>
        `${result.ok ? "✓" : "✗"} ${describe(result.action, nameOf)}${result.error ? ` — ${result.error}` : ""}`,
    );

  const run = async () => {
    const bridge = window.contextgit;
    if (!bridge || !instruction.trim()) return;
    if (!providerId) {
      setError("Connect a provider for the asset agent first.");
      return;
    }
    setBusy(true);
    setError(null);
    setLog([]);
    setPendingDeletes(null);
    try {
      const catalog = await bridge.assetsCatalog();
      const result = await api.assetAgent({
        provider_id: providerId,
        model: model || undefined,
        instruction: instruction.trim(),
        catalog: {
          assets: catalog.assets.map((asset) => ({
            id: asset.id,
            name: asset.name,
            kind: asset.kind,
            folder: asset.folder,
            tags: asset.tags,
          })),
          folders: catalog.folders,
        },
      });
      const actions = result.actions.map((action) => action as unknown as AgentAction);
      if (actions.length === 0) {
        setLog(["The agent proposed no changes."]);
        return;
      }
      const safe = actions.filter((action) => action.type !== "delete");
      const danger = actions.filter((action) => action.type === "delete");
      if (safe.length > 0) {
        record(format(await bridge.assetsApply(safe)));
        await onChanged();
      }
      if (danger.length > 0) setPendingDeletes(danger);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The agent failed");
    } finally {
      setBusy(false);
    }
  };

  const confirmDeletes = async () => {
    const bridge = window.contextgit;
    if (!bridge || !pendingDeletes) return;
    record(format(await bridge.assetsApply(pendingDeletes)));
    setPendingDeletes(null);
    await onChanged();
  };

  return (
    <>
      <Modal
        title="Asset agent"
        subtitle={selected ? `${selected.label} · ${model || selected.default_model || "default"}` : "Not configured"}
        size="lg"
        onClose={onClose}
      >
        <label className="cg-kicker" htmlFor="cg-agent-provider">
          Provider
        </label>
        <select
          id="cg-agent-provider"
          className="cg-input"
          value={providerId}
          onChange={(event) => {
            setProviderId(event.target.value);
            const next = providers.find((entry) => entry.id === event.target.value);
            setModel(next?.default_model ?? "");
          }}
        >
          <option value="">Choose a provider…</option>
          {providers
            .filter((entry) => entry.has_key || entry.id === providerId)
            .map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label} · {entry.vendor}
                {entry.has_key ? " (configured)" : ""}
              </option>
            ))}
        </select>
        <div className="cg-dock-actions">
          <button type="button" className="cg-btn" onClick={() => setConnectOpen(true)}>
            Connect provider…
          </button>
        </div>

        <label className="cg-kicker" htmlFor="cg-agent-model">
          Model
        </label>
        <input
          id="cg-agent-model"
          className="cg-input"
          list="cg-agent-model-list"
          value={model}
          placeholder={selected?.default_model ?? "e.g. gpt-4o-mini"}
          onChange={(event) => setModel(event.target.value)}
        />
        <datalist id="cg-agent-model-list">
          {(selected?.models ?? []).map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>

        <label className="cg-field-label" htmlFor="cg-agent-prompt">
          Instruction
        </label>
        <textarea
          id="cg-agent-prompt"
          className="cg-input"
          rows={3}
          value={instruction}
          placeholder="e.g. make a Logos folder and move every logo there; rename the hero shot to hero-v2.png"
          onChange={(event) => setInstruction(event.target.value)}
        />
        <div className="cg-dock-actions">
          <button
            type="button"
            className="cg-btn"
            data-variant="primary"
            disabled={busy || !instruction.trim() || !providerId}
            onClick={() => void run()}
          >
            {busy ? "Working…" : "Run"}
          </button>
        </div>
        {!providerId && (
          <p className="cg-empty-note">Connect a provider to run the agent.</p>
        )}

        {error && (
          <p className="cg-pane-error" role="alert">
            {error}
          </p>
        )}

        {log.length > 0 && (
          <ul className="cg-agent-log" aria-label="Agent actions">
            {log.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        )}

        {pendingDeletes && (
          <div className="cg-agent-danger" role="alert">
            <strong>The agent wants to delete these — confirm to continue:</strong>
            <ul>
              {pendingDeletes.flatMap((action) =>
                (action as Extract<AgentAction, { type: "delete" }>).ids.map((id) => (
                  <li key={id}>{nameOf(id)}</li>
                )),
              )}
            </ul>
            <div className="cg-dock-actions">
              <button type="button" className="cg-btn" onClick={() => setPendingDeletes(null)}>
                Skip deletes
              </button>
              <button
                type="button"
                className="cg-btn"
                data-variant="danger"
                onClick={() => void confirmDeletes()}
              >
                Delete anyway
              </button>
            </div>
          </div>
        )}
      </Modal>

      {connectOpen && (
        <AddProviderDialog
          title="Connect the asset agent"
          providers={providers}
          capability="chat"
          add={api.addAgentProvider}
          remove={api.deleteAgentProvider}
          test={api.testAgentProvider}
          fetchModels={api.fetchAgentProviderModels}
          onSaved={() => void load()}
          onClose={() => setConnectOpen(false)}
        />
      )}
    </>
  );
}
