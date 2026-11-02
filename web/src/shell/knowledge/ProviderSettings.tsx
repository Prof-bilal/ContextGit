import { useEffect, useState } from "react";
import { projectApi } from "@/shared/api";
import type { LearningProvider, LearningSettings } from "../../../shared/knowledge";

export default function ProviderSettings({ projectPath, onSaved, onClose }: {
  projectPath: string; onSaved: (settings: LearningSettings) => void; onClose: () => void;
}) {
  const [settings, setSettings] = useState<LearningSettings | null>(null);
  const [providerId, setProviderId] = useState("");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [attempt, setAttempt] = useState(0);
  const select = (provider: LearningProvider) => {
    setProviderId(provider.id); setModel(provider.default_model ?? "");
    setBaseUrl(provider.base_url); setKey(""); setNotice(""); setError(null);
  };
  useEffect(() => {
    let alive = true;
    void projectApi(projectPath).learningSettings().then(value => {
      if (!alive) return;
      setSettings(value);
      const selected = value.providers.find(p => p.id === value.default_provider)
        ?? value.providers.find(p => p.id === "openai") ?? value.providers[0];
      if (selected) select(selected);
    }).catch(cause => { if (alive) setError(cause instanceof Error ? cause.message : "Could not load AI connections"); });
    return () => { alive = false; };
  }, [projectPath, attempt]);
  const selected = settings?.providers.find(p => p.id === providerId);
  const perform = async (test: boolean) => {
    setBusy(true); setError(null); setNotice("");
    const api = projectApi(projectPath);
    const input = { provider_id: providerId, model: model.trim(), base_url: baseUrl.trim(), ...(key.trim() ? { api_key: key.trim() } : {}) };
    try {
      if (test) {
        const result = await api.testLearningConnection(input);
        setNotice(result.message);
      } else {
        await api.saveLearningConnection(input);
        setKey("");
        onSaved(await api.learningSettings());
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not configure this AI connection"); }
    finally { setBusy(false); }
  };
  return <section className="cg-knowledge-card cg-knowledge-form" aria-label="AI connection setup">
    <strong>Set up AI cleaning & learning</strong>
    <p className="cg-empty-note">Use your own provider and key. This connection is saved locally for this project. Testing sends a small request to the selected provider.</p>
    {!settings && !error && <p role="status">Loading providers…</p>}
    {error && <p role="alert" className="cg-banner">{error}{!settings && <button className="cg-btn" onClick={() => setAttempt(v => v + 1)}>Retry setup</button>}</p>}
    {settings && <fieldset disabled={busy}>
      <label>AI provider<select value={providerId} onChange={e => { const p = settings.providers.find(p => p.id === e.target.value); if (p) select(p); }}>
        {settings.providers.map(p => <option key={p.id} value={p.id}>{p.label}{p.user_configured ? " (saved)" : ""}</option>)}
      </select></label>
      {selected?.requires_key && <label>API key<input type="password" autoComplete="off" spellCheck={false} value={key} maxLength={8192} onChange={e => { setKey(e.target.value); setNotice(""); }} placeholder={selected.has_key ? "Leave blank to keep the saved key" : "Enter your API key"} /></label>}
      <label>Model<input value={model} maxLength={200} list="cg-learning-models" placeholder="Enter a model supported by your provider" onChange={e => { setModel(e.target.value); setNotice(""); }} /></label>
      <datalist id="cg-learning-models">{selected?.models.map(m => <option key={m} value={m} />)}</datalist>
      <details><summary>API endpoint</summary><label>API base URL<input type="url" value={baseUrl} onChange={e => { setBaseUrl(e.target.value); setNotice(""); }} /></label></details>
      {!selected?.requires_key && <p className="cg-empty-note">No API key is needed. Start your local model server and enter its model name.</p>}
      <div className="cg-knowledge-actions">
        <button type="button" className="cg-btn" disabled={!model.trim() || !baseUrl.trim()} onClick={() => void perform(true)}>{busy ? "Working…" : "Test connection"}</button>
        <button type="button" className="cg-btn" data-variant="primary" disabled={!model.trim() || !baseUrl.trim()} onClick={() => void perform(false)}>Save connection</button>
      </div>
    </fieldset>}
    {notice && <p role="status">{notice}</p>}
    <button type="button" className="cg-btn" disabled={busy} onClick={onClose}>Cancel setup</button>
  </section>;
}
