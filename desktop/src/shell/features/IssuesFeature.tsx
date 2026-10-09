import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type IssueConfig, type IssueFinding, type IssueScanRun } from "@/lib/api";
import { Chip, Field } from "../primitives";
import { FeaturePorts } from "../FeaturePorts";
import { useWorkbench } from "../WorkbenchContext";

const DEFAULT_CONFIG: IssueConfig = {
  enabled: false, timezone: "UTC", interval_hours: 5, schedule_minute: 17,
  scanners: ["secrets", "dependencies", "quality", "review"], minimum_severity: "high",
  minimum_confidence: 0.9, auto_create: false, github_repository: null, next_run_at: null, updated_at: "",
};
const SCANNERS = ["secrets", "dependencies", "quality", "review"] as const;
const SEVERITIES = ["critical", "high", "medium", "low"] as const;

function tone(severity: IssueFinding["severity"]): "bad" | "warn" | "ok" {
  return severity === "critical" || severity === "high" ? "bad" : severity === "medium" ? "warn" : "ok";
}
function formatDate(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—";
}

export default function IssuesFeature() {
  const { workspace, setProjectOpen } = useWorkbench();
  const [config, setConfig] = useState<IssueConfig>(DEFAULT_CONFIG);
  const [runs, setRuns] = useState<IssueScanRun[]>([]);
  const [findings, setFindings] = useState<IssueFinding[]>([]);
  const [scanner, setScanner] = useState("all");
  const [severity, setSeverity] = useState("all");
  const [busy, setBusy] = useState(false);
  const [installingOsv, setInstallingOsv] = useState(false);
  const [installPhase, setInstallPhase] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [nextConfig, nextRuns, nextFindings] = await Promise.all([api.issueConfig(), api.issueScans(), api.issueFindings()]);
    setConfig(nextConfig); setRuns(nextRuns); setFindings(nextFindings);
  }, []);
  useEffect(() => { void refresh().catch((error) => setMessage(error instanceof Error ? error.message : "Could not load issues")); }, [refresh]);
  useEffect(() => {
    if (!installingOsv) return;
    setInstallPhase(0);
    const timer = window.setInterval(() => setInstallPhase((phase) => Math.min(phase + 1, 3)), 1800);
    return () => window.clearInterval(timer);
  }, [installingOsv]);

  const run = async () => {
    setBusy(true); setMessage(null);
    try {
      const result = await api.runIssueScan();
      await refresh();
      const steps = Array.isArray(result.steps) ? result.steps : [];
      const detail = steps.length > 0 ? ` · ${steps.map((step) => `${step.scanner}: ${step.status}`).join(" · ")}` : "";
      setMessage(`${result.status === "done" ? "Scan complete" : "Scan failed"}${detail}`);
    }
    catch (error) { setMessage(error instanceof Error ? error.message : "Scan failed"); }
    finally { setBusy(false); }
  };
  const toggleSchedule = async () => {
    try { setConfig(config.enabled ? await api.pauseIssueSchedule() : await api.resumeIssueSchedule()); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not update schedule"); }
  };
  const update = async (patch: Partial<IssueConfig>) => {
    try { setConfig(await api.updateIssueConfig(patch)); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not update settings"); }
  };
  const filtered = useMemo(() => findings.filter((item) => (
    (scanner === "all" || item.scanner === scanner) && (severity === "all" || item.severity === severity)
  )), [findings, scanner, severity]);
  const linkedCount = findings.filter((item) => item.issue).length;
  const highCount = findings.filter((item) => item.severity === "critical" || item.severity === "high").length;
  const lastSteps = runs[0]?.steps ?? [];
  const dependencySkipped = lastSteps.find((step) => step.scanner === "dependencies" && step.status === "skipped");
  const qualitySkipped = lastSteps.find((step) => step.scanner === "quality" && step.status === "skipped");
  const installPercent = [10, 40, 70, 90][installPhase];

  const installOsv = async () => {
    setInstallingOsv(true); setMessage(null);
    try {
      const result = await api.installOsvScanner();
      setMessage(result.installed ? `${result.detail} Run the scan again to check dependencies.` : result.detail);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not install OSV-Scanner"); }
    finally { setInstallingOsv(false); }
  };

  const countFor = (key: string) => findings.filter((item) => item.scanner === key || item.severity === key).length;
  const rail = () => <nav className="cg-rail cg-issues-rail" aria-label="Issue filters">
    <div className="cg-rail-head"><div><h2>Issues</h2><span className="cg-rail-caption">Repository findings</span></div><button type="button" className="cg-new-btn" onClick={() => void run()} disabled={busy}>+ Scan</button></div>
    <div className="cg-filter-group"><span className="cg-filter-label">Scanner</span><button type="button" className="cg-filter-row" aria-current={scanner === "all"} onClick={() => setScanner("all")}><span>All scanners</span><b>{findings.length}</b></button>{SCANNERS.map((value) => <button key={value} type="button" className="cg-filter-row" aria-current={scanner === value} onClick={() => setScanner(value)}><span>{value}</span><b>{countFor(value)}</b></button>)}</div>
    <div className="cg-filter-group"><span className="cg-filter-label">Severity</span><button type="button" className="cg-filter-row" aria-current={severity === "all"} onClick={() => setSeverity("all")}><span>All severities</span><b>{findings.length}</b></button>{SEVERITIES.map((value) => <button key={value} type="button" className="cg-filter-row" aria-current={severity === value} onClick={() => setSeverity(value)}><span>{value}</span><b>{countFor(value)}</b></button>)}</div>
  </nav>;

  const view = () => <section className="cg-view-body cg-issues-view">
    <header className="cg-issues-header"><div className="cg-issues-heading"><span className="cg-kicker">Repository monitor</span><h1>Scheduled issues</h1><p>Read-only scans with conservative GitHub issue creation.</p></div><div className="cg-issues-actions"><button type="button" className="cg-btn" onClick={() => void toggleSchedule()}>{config.enabled ? "Pause schedule" : "Enable schedule"}</button><button type="button" className="cg-btn" data-variant="primary" onClick={() => void run()} disabled={busy}>{busy ? "Scanning…" : "Run scan"}</button></div></header>
    {message && <div className="cg-issues-notice" role="status">{message}</div>}
    <div className="cg-issues-metrics" aria-label="Issue summary"><div className="cg-issues-metric"><span>Schedule</span><strong>{config.enabled ? "Active" : "Paused"}</strong><small>{config.next_run_at ? `Next ${formatDate(config.next_run_at)}` : "No run scheduled"}</small></div><div className="cg-issues-metric"><span>Open findings</span><strong>{findings.length}</strong><small>{highCount} high priority</small></div><div className="cg-issues-metric"><span>GitHub issues</span><strong>{linkedCount}</strong><small>{config.auto_create ? "Auto-create enabled" : "Manual approval mode"}</small></div><div className="cg-issues-metric"><span>Last scan</span><strong>{runs[0]?.status ?? "Never"}</strong><small>{formatDate(runs[0]?.started_at)}</small></div></div>
    {(runs[0]?.steps ?? []).length > 0 && <div className="cg-issues-run-details" aria-label="Last scan details"><span className="cg-kicker">Last scan details</span>{(runs[0]?.steps ?? []).map((step) => <div className="cg-issues-run-step" key={step.scanner}><span className={`cg-issues-step-dot cg-issues-step-${step.status}`} /><strong>{step.scanner}</strong><span>{step.detail}</span><b>{step.findings}</b></div>)}</div>}
    {dependencySkipped && <aside className="cg-issues-action-panel" aria-label="Install OSV-Scanner"><div className="cg-issues-action-copy"><span className="cg-kicker">Dependency scanning unavailable</span><h3>Install OSV-Scanner?</h3><p>OSV-Scanner checks lockfiles against public vulnerability advisories. ContextGit will install it locally in this repository’s <code>.contextgit/tools</code> folder; nothing is installed without your approval.</p>{installingOsv && <div className="cg-issues-install-progress" role="status" aria-live="polite"><div className="cg-issues-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={installPercent} aria-label={`OSV-Scanner installation ${installPercent}%`}><span style={{ width: `${installPercent}%` }} /></div><small>{installPercent}% · {["Preparing local tools", "Downloading OSV-Scanner", "Installing scanner", "Verifying installation"][installPhase]}</small></div>}</div><button type="button" className="cg-btn" data-variant="primary" onClick={() => void installOsv()} disabled={installingOsv}>{installingOsv ? "Installing…" : "Install OSV-Scanner"}</button></aside>}
    {qualitySkipped && <aside className="cg-issues-info-panel" aria-label="Quality checks explanation"><div><span className="cg-kicker">Quality checks skipped</span><h3>Why didn’t quality run?</h3><p>Project commands such as <code>npm test</code>, <code>pytest</code>, and custom scripts can execute arbitrary code. ContextGit currently does not run them automatically until it can discover a bounded, read-only check for this repository.</p></div></aside>}
    <section className="cg-issues-panel" aria-labelledby="findings-title"><div className="cg-issues-panel-head"><div><span className="cg-kicker">Results</span><h2 id="findings-title">Findings</h2></div><span className="cg-issues-count">{filtered.length} shown</span></div>{filtered.length === 0 ? <div className="cg-issues-empty"><div className="cg-issues-empty-mark">✓</div><div><h3>{findings.length === 0 ? "No findings yet" : "No matching findings"}</h3><p>{findings.length === 0 ? "Run a scan to inspect secrets and dependency advisories." : "Try changing the scanner or severity filter."}</p></div></div> : <div className="cg-issues-list">{filtered.map((item) => <article className="cg-issue-item" key={item.id}><div className="cg-issue-item-main"><div className="cg-issue-item-title"><strong>{item.title}</strong><Chip tone={tone(item.severity)}>{item.severity}</Chip></div><div className="cg-issue-item-meta"><span>{item.location ?? "repository"}</span><span>{item.scanner}</span><span>{item.evidence}</span></div><p>{item.why}</p><small>Fix: {item.fix}</small></div><div className="cg-issue-item-link">{item.issue ? <a href={item.issue.issue_url} target="_blank" rel="noreferrer">Issue #{item.issue.issue_number} ↗</a> : <span>Not linked</span>}</div></article>)}</div>}</section>
  </section>;

  const installWorkflow = () => { void api.installIssuesWorkflow().then(() => setMessage("GitHub Actions workflow installed")).catch((error) => setMessage(error instanceof Error ? error.message : "Could not install workflow")); };
  const dock = () => <div className="cg-issues-settings"><div className="cg-issues-settings-head"><span className="cg-kicker">Configuration</span><h2>Issues</h2></div><div className="cg-fields"><Field label="Folder">{workspace?.path ?? "No folder selected"}</Field><Field label="Repository">{config.github_repository ?? "origin / GitHub"}</Field><Field label="Threshold">{config.minimum_severity} · {Math.round(config.minimum_confidence * 100)}%</Field><Field label="Scanners">{config.scanners.join(", ")}</Field></div><button type="button" className="cg-btn cg-issues-folder-button" data-variant="primary" onClick={() => setProjectOpen(true)}>Choose repository folder…</button><div className="cg-issues-settings-actions"><button type="button" className="cg-btn" onClick={installWorkflow}>Install GitHub workflow</button><button type="button" className="cg-btn" onClick={() => void update({ auto_create: !config.auto_create })}>{config.auto_create ? "Disable auto-create" : "Enable auto-create"}</button></div></div>;
  const footer = () => <footer className="cg-bottombar"><span className="cg-bb-info"><strong>Issues</strong><Chip tone={config.enabled ? "ok" : "warn"}>{config.enabled ? "scheduled" : "paused"}</Chip><span className="cg-view-sub">five-hour repository scan</span></span></footer>;
  return <FeaturePorts id="issues" title="Issues" rail={rail} view={view} dock={dock} footer={footer} />;
}
