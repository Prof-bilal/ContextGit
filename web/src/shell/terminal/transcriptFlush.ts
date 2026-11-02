/** Await the owning pane's buffered transcript before taking a checkpoint. */
const flushers = new Map<string, () => Promise<void>>();
export function registerTranscriptFlush(id: string, flush: () => Promise<void>): () => void {
  flushers.set(id, flush);
  return () => { if (flushers.get(id) === flush) flushers.delete(id); };
}
export async function flushSessionTranscript(id: string): Promise<void> {
  await flushers.get(id)?.();
}
