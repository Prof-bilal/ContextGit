/** OWNER: workspace agent. Terminal / Files / Changes / App tabs for one session. */
import type { Session } from "@/shared/api";
import EmbeddedTerminal from "../../shell/terminal/EmbeddedTerminal";
export default function Workspace({ session }: { session: Session }) {
  return <EmbeddedTerminal sessionId={session.id} />;
}
