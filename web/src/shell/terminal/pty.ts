/** Stable renderer-side identity for one backend session's persistent PTY. */
export function ptyIdForSession(sessionId: string): string {
  return `pty-${sessionId}`;
}
