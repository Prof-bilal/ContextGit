import { useEffect, useState } from "react";

import { api, type AgentRun } from "@/lib/api";
import { AgentMark } from "../primitives";
import WorkRunCard from "../chat/WorkRunCard";
import { isReady } from "../chat/providerStatus";
import { brandFor } from "../providers";
import { useWorkbench } from "../WorkbenchContext";
import { FeaturePorts } from "../FeaturePorts";

/** Repository work is the product's primary task surface. */
export default function WorkFeature() {
  const { providers, model, setModel, setPickerOpen, openProviderDialog, backendAvailable } = useWorkbench();
  const [task, setTask] = useState("");
  const [run, setRun] = useState<AgentRun | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const provider = providers.find((entry) => entry.id === model.providerId) ?? null;
  const ready = provider !== null && (isReady(provider) || provider.kind === "mock");
  const brand = brandFor(model.providerId, provider?.label ?? "");

  useEffect(() => {
    if (model.providerId || providers.length === 0) return;
    const pick = providers.find((entry) => entry.capability === "chat" && isReady(entry))
      ?? providers.find((entry) => entry.capability === "chat" && entry.kind === "mock");
    if (pick) setModel({ providerId: pick.id, modelId: pick.default_model ?? pick.models[0] ?? "" });
  }, [model.providerId, providers, setModel]);

  const start = async () => {
    const value = task.trim();
    if (!value || !ready || running || !backendAvailable) return;
    setRunning(true);
    setError(null);
    try {
      setRun(await api.createAgentRun(value, model.providerId, model.modelId));
      setTask("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start repository work");
    } finally {
      setRunning(false);
    }
  };

  const update = async (action: () => Promise<AgentRun>) => {
    setRunning(true);
    setError(null);
    try {
      setRun(await action());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update repository work");
    } finally {
      setRunning(false);
    }
  };

  const view = () => (
    <div className="cg-work-surface">
      <div className="cg-view-toolbar">
        <div>
          <h1>Work</h1>
          <p className="cg-view-sub">Describe a repository task. Review every change before it lands.</p>
        </div>
        <span className="cg-toolbar-spacer" />
        <button type="button" className="cg-btn" onClick={() => setPickerOpen(true)}>
          {provider?.label ?? "Choose provider"}
        </button>
      </div>

      <section className="cg-work-brief" aria-label="Repository task composer">
        <div className="cg-work-brief-head">
          <span className="cg-kicker">Approval-gated worktree</span>
          <span>{model.modelId || "No model selected"}</span>
        </div>
        <textarea
          aria-label="Repository task"
          placeholder="Example: Add a health endpoint and a regression test…"
          value={task}
          onChange={(event) => setTask(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void start();
          }}
          disabled={running || !backendAvailable}
        />
        <div className="cg-work-brief-actions">
          <span className="cg-view-sub">Ctrl/⌘ + Enter to plan</span>
          <button type="button" className="cg-btn" onClick={() => void start()} disabled={!task.trim() || !ready || running || !backendAvailable} data-variant="primary">
            {running ? "Working…" : "Plan task"}
          </button>
        </div>
      </section>

      {!ready && (
        <section className="cg-empty-state" aria-label="Connect a provider">
          <AgentMark agent={brand.hue} icon={brand.icon} label={brand.monogram} />
          <strong>Connect a model to start repository work</strong>
          <span>Work uses your provider for planning and implementation, then keeps the change isolated for review.</span>
          <button type="button" className="cg-btn" onClick={() => openProviderDialog("chat")}>Add provider</button>
        </section>
      )}

      {!run && ready && (
        <section className="cg-work-flow" aria-label="Work flow">
          <div className="cg-work-flow-heading">
            <span className="cg-kicker">A focused delivery loop</span>
            <span className="cg-view-sub">Everything stays reviewable</span>
          </div>
          <div className="cg-work-flow-steps">
            <div><span>01</span><strong>Describe</strong><p>State the outcome and any constraints.</p></div>
            <div><span>02</span><strong>Review</strong><p>Inspect the plan and isolated changes.</p></div>
            <div><span>03</span><strong>Ship</strong><p>Approve, commit, or turn the work into an issue.</p></div>
          </div>
        </section>
      )}

      {error && <p className="cg-banner" role="alert">{error}</p>}
      {run && (
        <WorkRunCard
          run={run}
          onApprove={() => void update(() => api.approveAgentRun(run.id, "approved"))}
          onReject={() => void update(() => api.approveAgentRun(run.id, "rejected"))}
          onCommit={() => void update(() => api.commitAgentRun(run.id, run.task))}
          onIssue={() => void update(() => api.createAgentIssue(run.id, `Follow-up: ${run.task.slice(0, 180)}`, run.plan?.summary ?? run.task).then(() => api.agentRun(run.id)))}
        />
      )}
    </div>
  );

  return <FeaturePorts id="work" title="Work" view={view} notice={null} />;
}
