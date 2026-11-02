/** OWNER: rail & home agent. Narrow icon rail (see docs/web-ui-plan.md). */
export default function LeftRail({ backendAvailable }: { backendAvailable: boolean }) {
  return <nav className="app-rail" aria-label="Main" data-backend={backendAvailable ? "ok" : "down"} />;
}
