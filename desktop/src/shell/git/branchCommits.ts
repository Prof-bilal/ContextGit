import type { Commit } from "@/lib/api";

/** Commits reachable from a branch head, newest first (walks parent links). */
export function commitsOnBranch(commits: Commit[], headId: string): Commit[] {
  const byId = new Map(commits.map((commit) => [commit.id, commit]));
  const seen = new Set<string>();
  const reachable: Commit[] = [];

  const walk = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const commit = byId.get(id);
    if (!commit) return;
    reachable.push(commit);
    for (const parent of commit.parent_ids) walk(parent);
  };
  walk(headId);

  return reachable.sort((a, b) => b.created_at.localeCompare(a.created_at));
}
