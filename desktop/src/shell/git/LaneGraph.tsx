import { useMemo } from "react";

import type { Branch, Commit } from "@/lib/api";
import { commitsOnBranch } from "./branchCommits";

/** A repo accumulates one branch per run; cap the lanes so the graph stays legible. */
const MAX_LANES = 8;
const COL_W = 132;
const LANE_H = 64;
const PAD_X = 56;
const PAD_Y = 46;

/** Lane colours cycle so neighbouring lanes never share one. */
const LANE_HUES = [
  "var(--cg-signal)",
  "var(--cg-ok)",
  "var(--cg-warn)",
  "#7c9cff",
  "#d98cff",
  "#69d2a0",
  "#f5e10a",
  "#5aa9ff",
];

const hueFor = (lane: number) => LANE_HUES[lane % LANE_HUES.length];

const shorten = (name: string, max = 18) =>
  name.length > max ? `${name.slice(0, max - 1)}…` : name;

interface PlacedCommit {
  commit: Commit;
  lane: number;
  level: number;
  x: number;
  y: number;
}

/**
 * A git-log-style lane graph over the real commit DAG: each branch with history
 * of its own gets a horizontal lane, commits sit in time order left-to-right
 * (longest path from a root), and edges are coloured by the lane that owns them.
 */
export default function LaneGraph({
  commits,
  branches,
  focusBranch,
  selectedId,
  onSelect,
}: {
  commits: Commit[];
  branches: Branch[];
  /** The branch the user selected in the rail; always gets the top lane. */
  focusBranch: string;
  selectedId: string | null;
  onSelect: (commitId: string) => void;
}) {
  const layout = useMemo(() => {
    const byId = new Map(commits.map((commit) => [commit.id, commit]));

    // Only branches with commits of their own earn a lane; the selected branch is
    // always shown. Ordering is by fork time, with the selected branch pinned top.
    const ranked = branches
      .map((branch) => {
        const own = commitsOnBranch(commits, branch.head_commit_id);
        return { branch, count: own.length, earliest: own[own.length - 1]?.created_at ?? "" };
      })
      .filter((entry) => entry.count > 1 || entry.branch.name === focusBranch);

    ranked.sort((a, b) => {
      if (a.branch.name === focusBranch) return -1;
      if (b.branch.name === focusBranch) return 1;
      return a.earliest.localeCompare(b.earliest) || a.branch.name.localeCompare(b.branch.name);
    });

    const lanes = ranked.slice(0, MAX_LANES).map((entry) => entry.branch);
    const laneOf = new Map(lanes.map((branch, index) => [branch.name, index]));

    // How many hops each commit sits below each lane's head, so a commit lands on
    // the lane that reaches it most directly.
    const distance = new Map<string, Map<string, number>>();
    for (const branch of lanes) {
      const dist = new Map<string, number>([[branch.head_commit_id, 0]]);
      const queue = [branch.head_commit_id];
      for (let head = 0; head < queue.length; head += 1) {
        const id = queue[head];
        const commit = byId.get(id);
        if (!commit) continue;
        for (const parent of commit.parent_ids) {
          if (dist.has(parent)) continue;
          dist.set(parent, (dist.get(id) ?? 0) + 1);
          queue.push(parent);
        }
      }
      distance.set(branch.name, dist);
    }

    // The DAG the lanes can reach. With no lanes at all, fall back to every commit.
    const visible = new Set<string>();
    for (const dist of distance.values()) for (const id of dist.keys()) visible.add(id);
    if (visible.size === 0) for (const commit of commits) visible.add(commit.id);

    // Longest path from a root → the column, so parents always sit left of children.
    const level = new Map<string, number>();
    const active = new Set<string>();
    const getLevel = (id: string): number => {
      const cached = level.get(id);
      if (cached !== undefined) return cached;
      if (active.has(id)) return 0;
      const commit = byId.get(id);
      if (!commit) return 0;
      active.add(id);
      const value =
        commit.parent_ids.length === 0
          ? 0
          : Math.max(...commit.parent_ids.map((parent) => getLevel(parent))) + 1;
      active.delete(id);
      level.set(id, value);
      return value;
    };

    const placed: PlacedCommit[] = [];
    for (const id of visible) {
      const commit = byId.get(id);
      if (!commit) continue;
      let lane = 0;
      let best = Number.POSITIVE_INFINITY;
      for (const branch of lanes) {
        const hops = distance.get(branch.name)?.get(id);
        if (hops !== undefined && hops < best) {
          best = hops;
          lane = laneOf.get(branch.name) ?? 0;
        }
      }
      placed.push({ commit, lane, level: getLevel(id), x: 0, y: 0 });
    }

    const maxLevel = placed.reduce((max, item) => Math.max(max, item.level), 0);
    // Extra right padding keeps the head branch label (centred over its node) from clipping.
    const width = PAD_X * 2 + maxLevel * COL_W + 64;
    const height = PAD_Y * 2 + Math.max(lanes.length - 1, 0) * LANE_H;
    for (const item of placed) {
      item.x = PAD_X + item.level * COL_W;
      item.y = PAD_Y + item.lane * LANE_H;
    }

    return { placed, position: new Map(placed.map((item) => [item.commit.id, item])), lanes, width, height };
  }, [commits, branches, focusBranch]);

  const { placed, position, lanes, width, height } = layout;

  const edgePath = (from: PlacedCommit, to: PlacedCommit) => {
    if (from.y === to.y) return `M${from.x} ${from.y} L${to.x} ${to.y}`;
    const mid = from.x + (to.x - from.x) / 2;
    return `M${from.x} ${from.y} C${mid} ${from.y} ${mid} ${to.y} ${to.x} ${to.y}`;
  };

  return (
    <svg
      className="cg-lane"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="group"
      aria-label="Commit lane graph"
    >
      <g className="cg-lane-edges">
        {placed.flatMap((item) =>
          item.commit.parent_ids.map((parentId, index) => {
            const parent = position.get(parentId);
            if (!parent) return null;
            return (
              <path
                key={`${parentId}-${item.commit.id}-${index}`}
                className="cg-lane-edge"
                data-merge={index === 0 ? undefined : "true"}
                d={edgePath(parent, item)}
                style={{ stroke: hueFor(index === 0 ? item.lane : parent.lane) }}
              />
            );
          }),
        )}
      </g>

      {lanes.map((branch, index) => {
        const head = position.get(branch.head_commit_id);
        if (!head) return null;
        return (
          <text
            key={branch.name}
            className="cg-lane-label"
            x={head.x}
            y={head.y - 20}
            style={{ fill: hueFor(index) }}
          >
            {shorten(branch.name)}
          </text>
        );
      })}

      {placed.map((item) => {
        const selected = item.commit.id === selectedId;
        const radius = item.commit.kind === "merge" ? 11 : 8;
        const hue = hueFor(item.lane);
        return (
          <g
            key={item.commit.id}
            className="cg-lane-node"
            data-kind={item.commit.kind}
            role="button"
            tabIndex={0}
            aria-pressed={selected}
            aria-label={`Commit ${item.commit.id.slice(0, 7)}, ${item.commit.kind}${
              item.commit.summary ? `, ${item.commit.summary}` : ""
            }`}
            onClick={() => onSelect(item.commit.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(item.commit.id);
              }
            }}
          >
            <circle className="cg-lane-hit" cx={item.x} cy={item.y} r={20} />
            {selected && (
              <circle className="cg-lane-sel" cx={item.x} cy={item.y} r={radius + 7} style={{ stroke: hue }} />
            )}
            <circle className="cg-lane-focus" cx={item.x} cy={item.y} r={radius + 7} />
            <circle className="cg-lane-dot" cx={item.x} cy={item.y} r={radius} style={{ stroke: hue }} />
            <text className="cg-lane-id" x={item.x} y={item.y + 26}>
              {item.commit.id.slice(0, 7)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
