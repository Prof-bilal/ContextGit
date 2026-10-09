# Workbench failure isolation

`Shell` owns stable DOM hosts, navigation, theme and coordination state. Each tab's
controller in `features/` owns its hooks, calculations, actions and dialogs. The
controllers are siblings under `FeatureBoundary`, so a failed hidden tab cannot
remove another tab or the navigation.

`FeaturePorts` sends content into the shell's hosts using React portals. A region's
render callback is evaluated *inside* `FeatureRegion`: evaluating it in `Shell` or
before the boundary would allow its calculations to escape isolation. Rails,
content, inspectors, actions and dialogs have independent retry controls. Failed
dialogs can also be dismissed to release native-view obscuring. Retrying a render
region preserves controller state; retrying a failed controller recreates only
that controller's local state. It never repeats a mutation automatically.

Code, Browser and Editor content remain mounted across tab switches. Other content
mounts while active, while its controller retains selection and draft state.
`TerminalHost` is a sibling of Code's controller, and each terminal pane has a
boundary. Code UI failures and retries must not unmount or restart live terminals.
A failure inside a terminal pane itself may dispose that pane's PTY; other panes
remain mounted.

Shared session, repository, project, provider, issue and trash hooks run in guarded
resource controllers. They publish snapshots independently of the UI. A resource
controller crash retains cached reads and replaces its actions with unavailable
handlers until it is retried. The controller and host are memoized so publishing a
snapshot does not cause a publish/render loop. Ordinary request errors remain in
hook state and can recover normally.

Catch promise rejections and event-handler failures explicitly: render boundaries
do not catch them. `useFeatureAction` reports fire-and-forget actions locally;
`useBackendPolling` routes unexpected background failures into the owning boundary.
Compute feature-specific values before updating shared state, rather than doing
fallible calculations inside a shared state updater that React executes in the
shell.

This is UI failure containment within the existing monorepo and local backend.
Renderer hangs, Electron process crashes and backend process outages need separate
process supervision/isolation; these boundaries do not protect against them.

Verification:

- `npm run build --prefix desktop`
- `npm run test:lifecycle --prefix desktop`
- `npm run test:e2e -- e2e/feature-isolation.spec.ts --workers=1`
- `npm run test:e2e -- e2e/desktop.spec.ts --workers=1`
