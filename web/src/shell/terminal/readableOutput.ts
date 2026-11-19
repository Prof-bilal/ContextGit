/** Convert PTY output into stable text for the Git/session history view. */
export function readableTerminalOutput(value: string): string {
  return value
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b[@-_]/g, "")
    // PTY programs use carriage returns and backspaces for in-place redraws.
    // They have no useful meaning in a saved transcript.
    .replace(/\r(?!\n)/g, "\n")
    .replace(/[\u0008\u007f]/g, "");
}
