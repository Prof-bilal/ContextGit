/** Observer only: preserves Pi's TUI and never adds a continuation or prompt. */
import fs from "node:fs";
export default function usageExtension(pi: any): void {
  const seen = new Set<string>();
  let tokens = 0, cost = 0;
  let hasTokens = false, hasCost = false;
  pi.on("message_end", (event: any) => {
    const message = event.message;
    if (message?.role !== "assistant" || !message.usage) return;
    const id = String(message.id ?? message.timestamp ?? "");
    if (!id || seen.has(id)) return;
    seen.add(id);
    const value = message.usage.totalTokens;
    const price = message.usage.cost?.total;
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) { tokens += value; hasTokens = true; }
    if (typeof price === "number" && Number.isFinite(price) && price >= 0) { cost += price; hasCost = true; }
    const file = process.env.CONTEXTGIT_USAGE_FILE;
    if (!file) return;
    try {
      fs.writeFileSync(`${file}.tmp`, JSON.stringify({ total_tokens: hasTokens ? tokens : null, total_cost: hasCost ? cost : null, requests: seen.size, period: "this launch" }), { mode: 0o600 });
      fs.renameSync(`${file}.tmp`, file);
    } catch { /* An unavailable usage sink must not interrupt a run. */ }
  });
}
