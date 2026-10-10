import { useMemo, useState } from "react";

import type {
  AuthStyle,
  ProviderCapability,
  ProviderInfo,
  ProviderInput,
  ProviderModelsResult,
  ProviderTestResult,
} from "@/lib/api";

import Modal from "../Modal";
import { AgentMark, Chip } from "../primitives";
import { brandFor } from "../providers";

const AUTH_STYLES: Array<{ value: AuthStyle; label: string }> = [
  { value: "bearer", label: "Bearer (Authorization)" },
  { value: "x-api-key", label: "x-api-key (Anthropic)" },
  { value: "api-key", label: "api-key (Azure)" },
  { value: "query", label: "query ?key=" },
  { value: "none", label: "none (local)" },
];

/**
 * The add-a-provider flow: add → test connection → fetch models → use.
 * A built-in is enabled by picking it; anything else is typed in. The key is
 * sent once to the local API and never comes back.
 */
export default function AddProviderDialog({
  providers,
  initialId,
  capability,
  title,
  add,
  remove,
  test,
  fetchModels,
  onSaved,
  onClose,
}: {
  providers: ProviderInfo[];
  /** Preselect a built-in (e.g. from a "connect a provider" quick pick). */
  initialId?: string;
  /** Only offer presets of this capability. */
  capability?: ProviderCapability;
  /** Override the dialog title (e.g. the asset agent's own connector). */
  title?: string;
  add: (input: ProviderInput) => Promise<ProviderInfo>;
  remove: (id: string) => Promise<void>;
  test: (id: string) => Promise<ProviderTestResult>;
  fetchModels: (id: string) => Promise<ProviderModelsResult>;
  onSaved: (provider?: ProviderInfo) => void;
  onClose: () => void;
}) {
  const presets = useMemo(
    () =>
      providers.filter(
        (provider) =>
          provider.is_builtin &&
          provider.kind !== "mock" &&
          (!capability || provider.capability === capability),
      ),
    [providers, capability],
  );
  const customs = useMemo(() => providers.filter((p) => !p.is_builtin), [providers]);
  const initial = presets.find((provider) => provider.id === initialId) ?? presets[0];

  const [selected, setSelected] = useState(initial?.id ?? "custom");
  const [label, setLabel] = useState(initial?.label ?? "");
  const [baseUrl, setBaseUrl] = useState(initial?.base_url ?? "");
  const [auth, setAuth] = useState<AuthStyle>(initial?.auth ?? "bearer");
  const [apiKey, setApiKey] = useState("");
  const [defaultModel, setDefaultModel] = useState(initial?.default_model ?? "");
  const [current, setCurrent] = useState<ProviderInfo | null>(null);
  const [tested, setTested] = useState<ProviderTestResult | null>(null);
  const [models, setModels] = useState<ProviderModelsResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = (value: string) => {
    setSelected(value);
    setCurrent(null);
    setTested(null);
    setModels(null);
    setError(null);
    const preset = presets.find((entry) => entry.id === value);
    setLabel(preset?.label ?? "");
    setBaseUrl(preset?.base_url ?? "");
    setAuth(preset?.auth ?? "bearer");
    setDefaultModel(preset?.default_model ?? "");
    setApiKey("");
  };

  const probe = async (id: string, saved?: ProviderInfo) => {
    const result = await test(id);
    setTested(result);
    if (result.ok) {
      try {
        setModels(await fetchModels(id));
      } catch {
        setModels(null);
      }
    }
    onSaved(saved);
  };

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const provider = await add({
        id: selected === "custom" ? undefined : selected,
        capability: selected === "custom" ? capability : undefined,
        label: label.trim() || undefined,
        base_url: baseUrl.trim() || undefined,
        auth_style: auth,
        api_key: apiKey.trim() || undefined,
        default_model: defaultModel.trim() || undefined,
      });
      setCurrent(provider);
      setApiKey("");
      await probe(provider.id, provider);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the provider");
    } finally {
      setBusy(false);
    }
  };

  const rerun = async (which: "test" | "models") => {
    if (!current || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (which === "test") await probe(current.id);
      else setModels(await fetchModels(current.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Provider call failed");
    } finally {
      setBusy(false);
    }
  };

  const drop = async (id: string) => {
    try {
      await remove(id);
      if (current?.id === id) {
        setCurrent(null);
        setTested(null);
        setModels(null);
      }
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove the provider");
    }
  };

  const preset = presets.find((entry) => entry.id === selected);
  const brand = brandFor(current?.id ?? selected, label || current?.label || "P");

  // Model choices: fetched live models, the preset's static list and any custom
  // value, as a dropdown so a model can be picked rather than typed.
  const modelOptions = [
    ...new Set([
      ...(models?.models ?? []),
      ...(preset?.models ?? []),
      ...(defaultModel ? [defaultModel] : []),
    ]),
  ];

  // A built-in that needs a key cannot be saved without one (it would 401 later).
  const keyRequired = selected !== "custom" ? (preset?.requires_key ?? true) : false;
  const hasStoredKey = Boolean(current?.key_hint) || Boolean(preset?.has_key);
  const needsKeyInput = keyRequired && !hasStoredKey && !apiKey.trim();

  return (
    <Modal
      title={
        title ??
        (capability === "image"
          ? "Add an image provider"
          : capability === "search"
            ? "Add a search provider"
            : "Add a model provider")
      }
      subtitle="Local key · never echoed back"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="cg-btn" onClick={onClose}>
            Close
          </button>
          {current && (
            <button
              type="button"
              className="cg-btn"
              data-variant="danger"
              onClick={() => current && void drop(current.id)}
            >
              Remove provider
            </button>
          )}
          <button
            type="button"
            className="cg-btn"
            data-variant="primary"
            disabled={busy || (selected === "custom" && !baseUrl.trim()) || needsKeyInput}
            onClick={() => void save()}
          >
            {busy ? "Working…" : current ? "Save changes" : "Save & test"}
          </button>
        </>
      }
    >
      <label className="cg-kicker" htmlFor="cg-provider-preset">
        Provider
      </label>
      <select
        id="cg-provider-preset"
        className="cg-text-input"
        value={selected}
        onChange={(event) => choose(event.target.value)}
      >
        {presets.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.label} · {entry.vendor}
            {entry.has_key ? " (configured)" : ""}
          </option>
        ))}
        <option value="custom">Custom OpenAI-compatible endpoint…</option>
      </select>

      <div className="cg-inline">
        <AgentMark agent={brand.hue} icon={brand.icon} label={brand.monogram} />
        <span className="cg-view-sub">
          {preset?.vendor ?? "Custom"}
          {preset && !preset.openai_shaped ? " · bespoke adapter" : ""}
        </span>
        {preset?.templated && <Chip tone="warn">fill the URL placeholders</Chip>}
      </div>

      <label className="cg-kicker" htmlFor="cg-provider-label">
        Label
      </label>
      <input
        id="cg-provider-label"
        className="cg-text-input"
        value={label}
        onChange={(event) => setLabel(event.target.value)}
        placeholder={
          selected === "custom"
            ? "e.g. My Gateway"
            : (preset?.label ?? "Provider name")
        }
      />

      <label className="cg-kicker" htmlFor="cg-provider-url">
        Base URL
      </label>
      <input
        id="cg-provider-url"
        className="cg-text-input"
        value={baseUrl}
        onChange={(event) => setBaseUrl(event.target.value)}
        placeholder="https://api.example.com/v1"
      />

      <div className="cg-form-row">
        <span>
          <label className="cg-kicker" htmlFor="cg-provider-auth">
            Auth
          </label>
          <select
            id="cg-provider-auth"
            className="cg-text-input"
            value={auth}
            onChange={(event) => setAuth(event.target.value as AuthStyle)}
          >
            {AUTH_STYLES.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </span>
        <span>
          <label className="cg-kicker" htmlFor="cg-provider-model">
            Default model
          </label>
          {modelOptions.length > 0 ? (
            <select
              id="cg-provider-model"
              className="cg-text-input"
              value={defaultModel}
              onChange={(event) => setDefaultModel(event.target.value)}
            >
              <option value="">(provider default)</option>
              {modelOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          ) : (
            <input
              id="cg-provider-model"
              className="cg-text-input"
              value={defaultModel}
              onChange={(event) => setDefaultModel(event.target.value)}
              placeholder="fetch models to pick one…"
            />
          )}
        </span>
      </div>

      <label className="cg-kicker" htmlFor="cg-provider-key">
        API key
      </label>
      <input
        id="cg-provider-key"
        className="cg-text-input"
        type="password"
        autoComplete="off"
        value={apiKey}
        onChange={(event) => setApiKey(event.target.value)}
        placeholder={preset?.requires_key === false ? "not needed for local" : "sk-…"}
      />
      <p className="cg-empty-note">
        The key is stored on this machine only and is never returned by the API.
      </p>
      {needsKeyInput && (
        <p className="cg-form-warn" role="alert">
          {preset?.label ?? "This provider"} needs an API key — paste it above, then save.
        </p>
      )}

      {current && (
        <div className="cg-dock-group">
          <span className="cg-kicker">Verify</span>
          <div className="cg-inline">
            {tested ? (
              <Chip tone={tested.ok ? "ok" : "bad"}>
                {tested.ok ? `connected · ${tested.latency_ms}ms` : "connection failed"}
              </Chip>
            ) : (
              <Chip>not tested</Chip>
            )}
            {models && (
              <Chip>
                {models.models.length} model{models.models.length === 1 ? "" : "s"} ·{" "}
                {models.source}
              </Chip>
            )}
            {current.key_hint && <Chip>key {current.key_hint}</Chip>}
          </div>
          {tested && !tested.ok && tested.error && (
            <p className="cg-pane-error">{tested.error}</p>
          )}
          {models && models.models.length > 0 && (
            <p className="cg-view-sub">{models.models.slice(0, 8).join(", ")}</p>
          )}
          <div className="cg-dock-actions">
            <button
              type="button"
              className="cg-btn"
              disabled={busy}
              onClick={() => void rerun("test")}
            >
              Test connection
            </button>
            <button
              type="button"
              className="cg-btn"
              disabled={busy}
              onClick={() => void rerun("models")}
            >
              Fetch models
            </button>
          </div>
        </div>
      )}

      {customs.length > 0 && (
        <div className="cg-dock-group">
          <span className="cg-kicker">Custom providers</span>
          <div className="cg-tags" role="group" aria-label="Custom providers">
            {customs.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className="cg-chip cg-chip-btn"
                title={`Remove ${entry.label}`}
                onClick={() => void drop(entry.id)}
              >
                {entry.label} ✕
              </button>
            ))}
          </div>
        </div>
      )}

      {error && <p className="cg-pane-error">{error}</p>}
    </Modal>
  );
}
