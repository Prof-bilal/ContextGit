/** Settings: AI provider for the project, workbench info, installed agent CLIs, about. */
import { useEffect, useMemo, useState } from "react";
import { LuCpu, LuServer, LuBot, LuLink, LuGithub, LuCheck, LuX, LuRefreshCw, LuTriangle } from "react-icons/lu";
import { projectApi } from "@/shared/api";
import type { LearningProvider, LearningSettings } from "@/shared/knowledge";
import { HARNESSES } from "@/shared/harnesses";
import type { BackendStatus } from "@/shared/status";
import { useApp } from "../context";
import { Button, EmptyState, PageHeader } from "../ui";
import { LibraryPage, LibraryContent, Section, Badge, NoProject, errorText } from "./shared";
import "./library.css";

export default function SettingsPage() {
  const { wb, go } = useApp();
  const projectPath = wb.activePath;
  const [settings, setSettings] = useState<LearningSettings | null>(null);
  const [providerId, setProviderId] = useState("");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [harnessChecks, setHarnessChecks] = useState<Record<string, { installed: boolean; path: string | null }>>({});
  const [backendStatus, setBackendStatus] = useState<{ status: BackendStatus; apiBase: string } | null>(null);

  const api = useMemo(() => (projectPath ? projectApi(projectPath) : null), [projectPath]);

  useEffect(() => {
    if (!api) return;
    let alive = true;
    void api.learningSettings().then(value => {
      if (!alive) return;
      setSettings(value);
      const selected = value.providers.find(p => p.id === value.default_provider)
        ?? value.providers.find(p => p.id === "openai") ?? value.providers[0];
      if (selected) {
        setProviderId(selected.id);
        setModel(selected.default_model ?? "");
        setBaseUrl(selected.base_url);
        setKey("");
        setNotice("");
        setError("");
      }
    }).catch(cause => { if (alive) setError(cause instanceof Error ? cause.message : "Could not load AI connections"); });
    return () => { alive = false; };
  }, [api, attempt]);

  const selected = settings?.providers.find(p => p.id === providerId);

  const perform = async (test: boolean) => {
    if (!api) return;
    setBusy(true); setError(""); setNotice("");
    const input = { provider_id: providerId, model: model.trim(), base_url: baseUrl.trim(), ...(key.trim() ? { api_key: key.trim() } : {}) };
    try {
      if (test) {
        const result = await api.testLearningConnection(input);
        setNotice(result.message);
      } else {
        await api.saveLearningConnection(input);
        setKey("");
        setSettings(await api.learningSettings());
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not configure this AI connection"); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    if (typeof window !== "undefined" && window.contextgit) {
      const status = window.contextgit.getStatus();
      if (status) setBackendStatus(status);
      for (const harness of HARNESSES) {
        window.contextgit.harnessCheck(harness.id)
          .then(result => setHarnessChecks(prev => ({ ...prev, [harness.id]: { installed: result.installed, path: result.path } })))
          .catch(() => setHarnessChecks(prev => ({ ...prev, [harness.id]: { installed: false, path: null } })));
      }
    }
  }, []);

  return (
    <LibraryPage title="Settings">
      <LibraryContent>
        <Section title="AI provider" description="The model ContextGit uses to draft memory and skills for this project. Agent CLIs use their own logins.">
          {!projectPath && <p className="lib-muted">Open a project to configure its AI provider.</p>}
          {projectPath && !settings && !error && <p role="status" className="lib-loading">Loading providers…</p>}
          {error && <p role="alert" className="ui-error">{error}{!settings && <Button variant="ghost" onClick={() => setAttempt(v => v + 1)}>Retry setup</Button>}</p>}
          {settings && <fieldset disabled={busy}>
            <label className="lib-field">
              <span className="ui-label">AI provider</span>
              <select className="ui-select" value={providerId} onChange={e => { const p = settings.providers.find(p => p.id === e.target.value); if (p) { setProviderId(p.id); setModel(p.default_model ?? ""); setBaseUrl(p.base_url); setKey(""); setNotice(""); setError(""); } }}>
                {settings.providers.map((p: LearningProvider) => <option key={p.id} value={p.id}>{p.label}{p.user_configured ? " (saved)" : ""}</option>)}
              </select>
            </label>
            {selected?.requires_key && <label className="lib-field">
              <span className="ui-label">API key</span>
              <input type="password" className="ui-input" autoComplete="off" spellCheck={false} value={key} maxLength={8192} onChange={e => { setKey(e.target.value); setNotice(""); }} placeholder={selected.has_key ? "Leave blank to keep the saved key" : "Enter your API key"} />
            </label>}
            <label className="lib-field">
              <span className="ui-label">Model</span>
              <input className="ui-input" value={model} maxLength={200} list="cg-learning-models" placeholder="Enter a model supported by your provider" onChange={e => { setModel(e.target.value); setNotice(""); }} />
              <datalist id="cg-learning-models">{selected?.models.map((m: string) => <option key={m} value={m} />)}</datalist>
            </label>
            <details><summary>API endpoint</summary>
              <label className="lib-field" style={{ marginTop: "var(--app-s3)" }}>
                <span className="ui-label">API base URL</span>
                <input type="url" className="ui-input" value={baseUrl} onChange={e => { setBaseUrl(e.target.value); setNotice(""); }} />
              </label>
            </details>
            {!selected?.requires_key && <p className="lib-muted">No API key is needed. Start your local model server and enter its model name.</p>}
            <div className="lib-actions lib-actions--end">
              <Button type="button" disabled={!model.trim() || !baseUrl.trim()} onClick={() => void perform(true)}>{busy ? "Working…" : "Test connection"}</Button>
              <Button type="button" variant="primary" disabled={!model.trim() || !baseUrl.trim()} onClick={() => void perform(false)}>Save connection</Button>
            </div>
          </fieldset>}
          {notice && <p role="status" className="lib-notice">{notice}</p>}
        </Section>
        <Section title="This app" description="Where the app and its local API are running.">
          <dl className="lib-kv">
            <div><dt>UI address</dt><dd><code className="lib-mono">{typeof window !== "undefined" ? window.location.origin : "—"}</code></dd></div>
            <div><dt>API address</dt><dd><code className="lib-mono">{backendStatus?.status.state === "ready" ? backendStatus.status.apiBase : (backendStatus?.apiBase ?? (typeof window !== "undefined" && window.contextgit?.apiBase) ?? "—")}</code></dd></div>
            <div><dt>Backend status</dt><dd><Badge tone={backendStatus?.status.state === "ready" ? "ok" : "bad"}>{backendStatus?.status.state ?? "unknown"}</Badge><Button variant="ghost" size="sm" onClick={() => { const status = window.contextgit?.getStatus(); if (status) setBackendStatus(status); }} disabled={busy}><LuRefreshCw style={{ width: 14, height: 14 }} /></Button></dd></div>
          </dl>
        </Section>

        <Section title="Agents" description="Agent CLIs found on this machine's PATH.">
          <ul className="lib-agents">
            {HARNESSES.map(harness => {
              const check = harnessChecks[harness.id];
              return (
                <li key={harness.id} className="lib-agent">
                  <span className="lib-agent-mark">{harness.monogram}</span>
                  <div>
                    <strong>{harness.label}</strong>
                    <small>{harness.command ?? "shell"}</small>
                  </div>
                  {check !== undefined && (
                    <Badge tone={check.installed ? "ok" : "bad"}>{check.installed ? "installed" : "not installed"}</Badge>
                  )}
                </li>
              );
            })}
          </ul>
        </Section>

        <Section title="About">
          <p>ContextGit keeps a history of your agent sessions, like git does for code: branch, compare, merge and roll back what agents worked on. Everything stays on this machine; only calls to the model you configure leave it.</p>
          <p><a href="https://github.com/Prof-bilal/ContextGit" target="_blank" rel="noopener noreferrer" className="lib-link"><LuGithub /> View on GitHub</a></p>
        </Section>
      </LibraryContent>
    </LibraryPage>
  );
}
