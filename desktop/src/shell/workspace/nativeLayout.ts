export type ViewBounds = { x: number; y: number; width: number; height: number };
const equal = (a: ViewBounds | null, b: ViewBounds) => a !== null && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/** Latest rectangle wins; slow native IPC must never build an animation queue. */
export class NativeLayout {
  private last: ViewBounds | null = null;
  private pending: ViewBounds | null = null;
  private running = false;
  private disposed = false;
  constructor(private readonly apply: (bounds: ViewBounds) => Promise<unknown>, private readonly onError: (error: unknown) => void) {}
  update(bounds: ViewBounds) {
    if (this.disposed) return;
    this.pending = bounds;
    void this.flush();
  }
  private async flush() {
    if (this.running || this.disposed) return;
    this.running = true;
    try {
      while (this.pending && !this.disposed) {
        const next = this.pending;
        this.pending = null;
        if (equal(this.last, next)) continue;
        await this.apply(next);
        this.last = next;
      }
    } catch (error) { if (!this.disposed) this.onError(error); }
    finally { this.running = false; }
  }
  dispose() { this.disposed = true; this.pending = null; }
}
