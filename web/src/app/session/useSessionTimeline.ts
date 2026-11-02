/**
 * What is known about one session, as a time-ordered list: start, status
 * changes, commits/checkpoints, agent-run steps, and team messages when the
 * session belongs to a team. Polls gently (5s) through `useBackendPolling`,
 * which pauses while the tab is hidden and stops on unmount.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { projectApi, type Session, type SessionDetail, type SessionStatus, type SpatialTeam, type TeamMessage } from "@/shared/api";
import { useBackendPolling } from "../../shell/useBackendPolling";
import { STATUS_TEXT } from "./format";

export type TimelineKind = "start" | "status" | "commit" | "step" | "team" | "sent";

export interface TimelineEntry {
  id: string;
  at: string;
  kind: TimelineKind;
  title: string;
  body?: string;
  tone?: "ok" | "bad" | "info" | "accent";
}

export interface SentMessage { id: string; at: string; text: string }

interface TeamLink { teamId: string; teamName: string; taskId: string | null; orchestrator: boolean }

function findTeamLink(teams: SpatialTeam[], sessionId: string): TeamLink | null {
  for (const team of teams) {
    if (team.team.orchestrator_session_id === sessionId) return { teamId: team.team.id, teamName: team.team.name, taskId: null, orchestrator: true };
    const task = team.tasks.find(item => item.session_id === sessionId || item.verifier_session_id === sessionId);
    if (task) return { teamId: team.team.id, teamName: team.team.name, taskId: task.id, orchestrator: false };
  }
  return null;
}

const STATUS_TONE: Record<SessionStatus, TimelineEntry["tone"]> = { running: "ok", idle: undefined, done: "info", error: "bad" };

export function useSessionTimeline(session: Session, sent: SentMessage[]) {
  const api = useMemo(() => projectApi(session.project_path ?? undefined), [session.project_path]);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [team, setTeam] = useState<TeamLink | null>(null);
  const [teamMessages, setTeamMessages] = useState<TeamMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const tick = useRef(0);
  const teamRef = useRef<TeamLink | null>(null);

  const poll = useCallback(async (current: () => boolean) => {
    const turn = tick.current++;
    try {
      const next = await api.sessionDetail(session.id);
      if (!current()) return;
      setDetail(next);
      setError(null);
      // Team membership rarely changes: look it up on the first read and then every ~30s.
      if (session.project_path && (turn % 6 === 0)) {
        const teams = await api.teams(session.project_path);
        if (!current()) return;
        teamRef.current = findTeamLink(teams, session.id);
        setTeam(teamRef.current);
      }
      const link = teamRef.current;
      if (link) {
        const messages = await api.spatialTeamMessages(link.teamId, 80);
        if (!current()) return;
        setTeamMessages(link.orchestrator ? messages : messages.filter(message => (!message.task_id && !message.from_task_id) || message.task_id === link.taskId || message.from_task_id === link.taskId));
      }
    } catch (cause) {
      if (current()) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (current()) setLoaded(true);
    }
  }, [api, session.id, session.project_path]);

  const refresh = useBackendPolling(poll, 5000);

  // Status changes observed while this view is open.
  const [statusLog, setStatusLog] = useState<{ status: SessionStatus; at: string }[]>(() => [{ status: session.status, at: session.updated_at }]);
  useEffect(() => {
    setStatusLog(log => log[log.length - 1]?.status === session.status ? log : [...log, { status: session.status, at: new Date().toISOString() }]);
  }, [session.status]);

  const entries = useMemo(() => {
    const list: TimelineEntry[] = [{ id: "start", at: session.created_at, kind: "start", title: "Session created", body: session.worktree_path ? "Running in its own worktree" : undefined }];
    statusLog.forEach((item, index) => {
      // The initial "idle" reading right after creation is noise.
      if (index === 0 && item.status === "idle") return;
      list.push({ id: `status-${index}`, at: item.at, kind: "status", title: STATUS_TEXT[item.status], tone: STATUS_TONE[item.status] });
    });
    for (const commit of detail?.commits ?? []) {
      if (commit.kind === "root") continue;
      list.push({
        id: `commit-${commit.id}`,
        at: commit.created_at,
        kind: "commit",
        title: commit.kind === "merge" ? "Merged context" : commit.kind === "note" ? "Note" : "Checkpoint saved",
        body: commit.summary ?? commit.messages.find(message => message.role !== "system")?.content.slice(0, 240),
        tone: "accent",
      });
    }
    for (const step of detail?.agent_run?.steps ?? []) {
      list.push({
        id: `step-${step.id}`,
        at: step.created_at,
        kind: "step",
        title: `${step.kind.replace(/_/g, " ")}${step.status && step.status !== "done" ? ` · ${step.status}` : ""}`,
        body: step.output_summary || step.input_summary || undefined,
        tone: step.status === "failed" ? "bad" : undefined,
      });
    }
    for (const message of teamMessages) {
      list.push({ id: `team-${message.id}`, at: message.created_at, kind: "team", title: `Team ${message.kind}`, body: message.body, tone: message.kind === "gate" || message.kind === "review" ? "info" : undefined });
    }
    for (const message of sent) list.push({ id: `sent-${message.id}`, at: message.at, kind: "sent", title: "You sent", body: message.text });
    return list.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  }, [session.created_at, session.worktree_path, statusLog, detail, teamMessages, sent]);

  return { entries, detail, team, error, loaded, refresh };
}
