/** OWNER: session agent. Header + activity panel (left) + Workspace (right). */
import type { Session } from "@/shared/api";
import Workspace from "../workspace/Workspace";
export default function SessionView({ session }: { session: Session }) {
  return <Workspace session={session} />;
}
