import { useBackendPolling } from "../useBackendPolling";
import HarnessLimitsPanel from "./HarnessLimitsPanel";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type IntegrationJob, type IntegrationSettings, type Session } from "@/lib/api";

export default function MergeAgentPanel({ project, sessions }: { project: string; sessions: Session[] }) {
  const [settings, setSettings] = useState<IntegrationSettings | null>(null);
  const [jobs, setJobs] = useState<IntegrationJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    const ticket = ++generation.current;
    setSettings(null); setJobs([]); setError(null); setBusy(false);
    void api.integrationSettings(project).then(value => {
      if (ticket === generation.current) setSettings(value);
    }).catch(cause => { if (ticket === generation.current) setError(String(cause)); });
    return () => { generation.current++; };
  }, [project]);
  const load = useCallback(async (current: () => boolean) => {
    const ticket = generation.current;
    try {
      const value = await api.integrationJobs(project);
      if (current() && ticket === generation.current) { setJobs(value); setError(null); }
    } catch (cause) {
      if (current() && ticket === generation.current) setError(String(cause));
    }
  }, [project]);
  const refresh = useBackendPolling(load, 1000);
  const act = async (operation: () => Promise<unknown>) => {
    const ticket = generation.current;
    setBusy(true); setError(null);
    try { await operation(); if (ticket === generation.current) await refresh(); }
    catch (cause) { if (ticket === generation.current) setError(String(cause)); }
    finally { if (ticket === generation.current) setBusy(false); }
  };
  const authority = (value: IntegrationSettings["authority"]) => void act(async () => {
    const ticket = generation.current;
    if (settings) { const saved = await api.configureIntegration({ ...settings, authority: value }); if (ticket === generation.current) setSettings(saved); }
  });
  return <section className="cg-limits" aria-label="Merge Agent">
    <h2>Merge Agent</h2>
    <p className="cg-view-sub">Reviews committed worker code, resolves conflicts, runs checks, and integrates locally. Authority applies to this project. GitHub push is a separate action.</p>
    {error && <p role="alert">{error}</p>}
    {settings && <>
      <label>CLI <select aria-label="Merge agent CLI" disabled={busy || settings.authority === "enabled"} value={settings.harness} onChange={e => setSettings({ ...settings, harness: e.target.value as "codex" | "claude" })}>
        <option value="codex">Codex</option><option value="claude">Claude Code</option>
      </select></label>{" "}
      <label>Target branch <select aria-label="Integration target" disabled={busy || settings.authority === "enabled"} value={settings.target} onChange={e => setSettings({ ...settings, target: e.target.value })}>
        <option value="">Select branch</option>{settings.branches.map(branch => <option key={branch}>{branch}</option>)}
      </select></label>{" "}
      <label>Required checks <input aria-label="Required integration checks" disabled={busy || settings.authority === "enabled"} value={settings.checks} placeholder="npm test" onChange={e => setSettings({ ...settings, checks: e.target.value })} /></label>
      <p role="status">Authority: {settings.authority}</p>
      <button className="cg-btn" disabled={busy || !settings.target || !settings.checks.trim() || settings.authority === "enabled"} onClick={() => authority("enabled")}>Enable automatic integration</button>{" "}
      <button className="cg-btn" disabled={busy || settings.authority !== "enabled"} onClick={() => authority("paused")}>Pause</button>{" "}
      <button className="cg-btn" disabled={busy || settings.authority === "disabled"} onClick={() => authority("disabled")}>Revoke authority</button>
      <h3>Worker readiness</h3>
      {sessions.filter(session => session.project_path === project && session.git_branch).map(session => <p key={session.id}>
        {session.name}{" "}<button className="cg-btn" disabled={busy || settings.authority !== "enabled"} onClick={() => void act(() => api.readyForIntegration(session.id))}>Ready for integration</button>
      </p>)}
    </>}
    <h3>Integration jobs</h3>
    {!jobs.length && <p>No queued runs.</p>}
    {jobs.map(job => <article key={job.id}>
      <strong>{sessions.find(session => session.id === job.session_id)?.name ?? job.session_id} · {job.state}</strong>
      <p>{job.source_sha.slice(0, 12)} · attempt {job.attempts} · {job.verdict ?? "awaiting review"}</p>
      <p>Conversation evidence: {job.conversation_branch}</p>
      {job.conflicts.length > 0 && <p>Conflict files: {job.conflicts.join(", ")}</p>}
      <p role="status">{job.feedback}</p>
      {job.candidate_commit && <p>Candidate / resulting commit: <code>{job.candidate_commit}</code></p>}
      {job.resolution_diff && <details><summary>Resolution diff</summary><pre>{job.resolution_diff}</pre></details>}
      {job.check_output && <details><summary>Check output</summary><pre>{job.check_output}</pre></details>}
      {job.usage && <HarnessLimitsPanel harness={job.usage.harness} limits={job.usage} loading={false} onRefresh={() => void act(() => api.integrationJobs(project))} />}
      {["queued", "building", "reviewing", "checking", "publishing"].includes(job.state) && <button className="cg-btn" disabled={busy} onClick={() => void act(() => api.integrationAction(job.id, "cancel"))}>Cancel</button>}
      {["failed", "cancelled", "interrupted"].includes(job.state) && <button className="cg-btn" disabled={busy || settings?.authority !== "enabled"} onClick={() => void act(() => api.integrationAction(job.id, "retry"))}>Retry</button>}
    </article>)}
  </section>;
}
