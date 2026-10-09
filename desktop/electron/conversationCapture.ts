/** Launch-scoped binding; no terminal text, clock or prompt matching. */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

export function prepareOpenCodeCapture(root: string, sessionId: string, directory: string, nativeId?: string,
  originalConfig = "{}"): { args: string[]; env: Record<string, string> } {
  const captureDirectory = path.join(root, "captures", "opencode");
  fs.mkdirSync(captureDirectory, { recursive: true, mode: 0o700 });
  const key = createHash("sha256").update(sessionId).digest("hex");
  const receipt = path.join(captureDirectory, `${key}.json`);
  const helper = path.join(captureDirectory, `${key}.mjs`);
  // Embed launch identity rather than relying on inherited env in child agents.
  const identity = JSON.stringify({ session_id: sessionId, directory: fs.realpathSync(directory) });
  fs.writeFileSync(helper, `import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
export const ContextGitCapture = async ({ client }) => ({
  "chat.message": async ({ sessionID }) => {
    const response = await client.session.get({ path: { id: sessionID } });
    const session = response.data;
    if (!session || session.parentID) return;
    const identity = ${identity};
    if (fs.realpathSync(session.directory) !== identity.directory) return;
    const receipt = ${JSON.stringify(receipt)};
    const value = { ...identity, native_id: sessionID };
    if (fs.existsSync(receipt)) {
      if (JSON.parse(fs.readFileSync(receipt, "utf8")).native_id !== sessionID)
        throw new Error("This ContextGit session is linked to another conversation. Create a new ContextGit session.");
      return;
    }
    const temporary = receipt + "." + randomUUID();
    fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" });
    try { fs.linkSync(temporary, receipt); }
    catch (error) {
      if (error.code !== "EEXIST" || JSON.parse(fs.readFileSync(receipt, "utf8")).native_id !== sessionID) throw error;
    } finally { fs.unlinkSync(temporary); }
  }
});
`, { mode: 0o600 });
  if (nativeId) {
    const value = { session_id: sessionId, directory: fs.realpathSync(directory), native_id: nativeId };
    if (!fs.existsSync(receipt)) fs.writeFileSync(receipt, JSON.stringify(value), { flag: "wx", mode: 0o600 });
    else if (JSON.parse(fs.readFileSync(receipt, "utf8")).native_id !== nativeId) throw new Error("OpenCode binding conflict");
  }
  const config = JSON.parse(originalConfig);
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("Invalid OpenCode config");
  if (config.plugin !== undefined && !Array.isArray(config.plugin)) throw new Error("Invalid OpenCode plugin config");
  config.plugin = [...(config.plugin ?? []), pathToFileURL(helper).href];
  return { args: nativeId ? ["--session", nativeId] : [], env: { OPENCODE_CONFIG_CONTENT: JSON.stringify(config) } };
}
