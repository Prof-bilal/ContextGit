# Dedicated merge agent

Open Code → Merge Agent for the selected project. Select Codex or Claude Code,
select a local target branch, and enter the required check command. Authority is
disabled by default. **Enable automatic integration** explicitly grants the
project's agent permission to review, resolve, check, and integrate code locally.
Pause stops active work; Revoke authority invalidates its publication permission.
Stopped jobs can be retried after authority is enabled again.

Commit the worker's changes and leave its worktree clean, then click **Ready for
integration** or call the MCP `ready_for_integration` tool. Use `integration_status`
with its returned job id to read progress and worker feedback. Terminal exit does not
submit work. Successful Team completion submits committed work when authority is
enabled; the task stays in review until integration succeeds.

The backend owns the durable queue. A private clone builds each candidate without
sharing the worker's Git metadata. Both CLI adapters return structured verdicts
and patches; the application validates paths, stages resolutions, and runs checks.
No permission bypass, project hooks, MCP tools, or GitHub push is enabled by this
role. Codex uses a read-only sandbox and a separate temporary config with only its
login credentials. Claude starts without tools, inherited settings, or hooks.

Review and checks each have a 15-minute timeout. A patch may be corrected once.
Moving target heads cause rebuilding and retesting; moving worker heads require
new readiness. Dirty targets and active Git operations block publication. The
application never stashes or discards edits. Interrupted jobs reconcile recorded
checked commits on restart and otherwise require retry.

Desktop supplies an ephemeral local bearer token for `/api/v1/integration/*`.
For an independently launched backend, set `CONTEXTGIT_API_TOKEN` and send it as
`Authorization: Bearer …`. Without it the integration APIs reject requests.
The CLI must be installed and signed in on the backend's PATH. Automated tests use
fake CLI processes and temporary repositories, so they need no paid inference.

Local usage observers publish preload events, with file watches and a one-second
fallback. Re-reading unchanged data preserves its observation timestamp. Visible
account/project readings refresh every 30 seconds; other account badges refresh
at five-minute intervals. Codex shares an account connection and listens for quota
and authentication events, with a 30-second fallback for external CLI activity.
Failures retain valid readings with a stale label and exponential retry backoff;
manual Refresh bypasses caches. Reset countdowns redraw locally every second.
Session totals, launch identifiers, and account quota readings remain separate.
Merge-agent usage uses the same normalized usage panel and backend usage ledger.
