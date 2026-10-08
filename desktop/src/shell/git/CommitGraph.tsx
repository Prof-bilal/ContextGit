import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo } from "react";

import type { Branch, Commit } from "@/lib/api";

type GraphNode = Node<{ commit: Commit; branches: string[] }, "commit">;
type GraphEdge = Edge;

/** Commits reachable from any branch head, plus the branches covering each. */
function visibleHistory(commits: Commit[], branches: Branch[]) {
  const byId = new Map(commits.map((commit) => [commit.id, commit]));
  const visible = new Set<string>();
  for (const head of branches.map((branch) => branch.head_commit_id)) {
    const pending = [head];
    while (pending.length > 0) {
      const current = pending.pop();
      if (!current || visible.has(current)) continue;
      visible.add(current);
      pending.push(...(byId.get(current)?.parent_ids ?? []));
    }
  }

  const branchesByCommit = new Map<string, string[]>();
  for (const branch of branches) {
    const pending = [branch.head_commit_id];
    while (pending.length > 0) {
      const current = pending.pop();
      if (!current || !visible.has(current)) continue;
      const names = branchesByCommit.get(current) ?? [];
      if (!names.includes(branch.name)) names.push(branch.name);
      branchesByCommit.set(current, names);
      pending.push(...(byId.get(current)?.parent_ids ?? []));
    }
  }

  return { kept: commits.filter((commit) => visible.has(commit.id)), branchesByCommit, visible };
}

function GraphCommit({ data, selected }: { data: GraphNode["data"]; selected: boolean }) {
  return (
    <div className={`cg-graph-node${selected ? " is-selected" : ""}`}>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <span className={`cg-graph-kind kind-${data.commit.kind}`}>{data.commit.kind}</span>
      <strong className="cg-graph-id">{data.commit.id.slice(0, 7)}</strong>
      <span className="cg-graph-branches">{data.branches.join(" · ") || "unlabelled"}</span>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}

const nodeTypes = { commit: GraphCommit };

/** Lay the DAG out by generation (x) and lane (y), one lane per branch. */
function buildGraph(
  commits: Commit[],
  branches: Branch[],
  selectedId: string | null,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const { kept, branchesByCommit, visible } = visibleHistory(commits, branches);
  const ordered = [...kept].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const levels = new Map<string, number>();
  const byId = new Map(ordered.map((commit) => [commit.id, commit]));
  const active = new Set<string>();

  const getLevel = (id: string): number => {
    const cached = levels.get(id);
    if (cached !== undefined) return cached;
    if (active.has(id)) return 0;
    const commit = byId.get(id);
    if (!commit) return 0;
    active.add(id);
    const level =
      commit.parent_ids.length === 0
        ? 0
        : Math.max(...commit.parent_ids.map((parent) => getLevel(parent))) + 1;
    active.delete(id);
    levels.set(id, level);
    return level;
  };
  for (const commit of ordered) getLevel(commit.id);

  const laneNames = branches.map((branch) => branch.name);
  const laneByBranch = new Map(laneNames.map((name, index) => [name, index]));

  const nodes: GraphNode[] = ordered.map((commit) => {
    const memberships = branchesByCommit.get(commit.id) ?? [];
    const headBranch = branches.find((branch) => branch.head_commit_id === commit.id)?.name;
    const lane = headBranch ?? memberships[0] ?? laneNames[0] ?? "main";
    return {
      id: commit.id,
      type: "commit" as const,
      position: {
        x: (levels.get(commit.id) ?? 0) * 210,
        y: (laneByBranch.get(lane) ?? 0) * 108,
      },
      data: { commit, branches: memberships },
      selected: selectedId === commit.id,
      ariaLabel: `Commit ${commit.id}, ${commit.kind}, branches ${memberships.join(", ") || "none"}`,
    };
  });

  const edges: GraphEdge[] = ordered.flatMap((commit) =>
    commit.parent_ids
      .filter((parent) => visible.has(parent) && byId.has(parent))
      .map((parent, index) => ({
        id: `${parent}-${commit.id}-${index}`,
        source: parent,
        target: commit.id,
        type: "smoothstep" as const,
        label: index === 0 ? undefined : "merge parent",
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: index === 0 ? "#46b89c" : "#ff6a3d",
          width: 16,
          height: 16,
        },
        style: {
          stroke: index === 0 ? "#46b89c" : "#ff6a3d",
          strokeWidth: 2.5,
          opacity: 0.95,
        },
      })),
  );

  return { nodes, edges };
}

/** The real commit DAG. Clicking a node selects that commit. */
export default function CommitGraph({
  commits,
  branches,
  selectedId,
  onSelect,
}: {
  commits: Commit[];
  branches: Branch[];
  selectedId: string | null;
  onSelect: (commitId: string) => void;
}) {
  const { nodes, edges } = useMemo(
    () => buildGraph(commits, branches, selectedId),
    [commits, branches, selectedId],
  );

  return (
    <div className="cg-graph">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={(_: unknown, node: GraphNode) => onSelect(node.id)}
        onNodesChange={() => undefined}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        minZoom={0.1}
        maxZoom={1.5}
        nodesFocusable
        nodesDraggable={false}
        edgesFocusable
      >
        <Background color="#3a332b" gap={22} />
        <MiniMap
          position="bottom-right"
          style={{ width: 124, height: 82 }}
          bgColor="var(--cg-surface)"
          maskColor="rgba(0, 0, 0, 0.35)"
          nodeColor={(node) => (node.selected ? "#ff6a3d" : "#46b89c")}
          pannable
          zoomable
        />
        <Controls />
      </ReactFlow>
    </div>
  );
}
