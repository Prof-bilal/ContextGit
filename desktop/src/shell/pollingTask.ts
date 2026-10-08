/** One request at a time, with results invalidated by disconnects and explicit refreshes. */
export class PollingTask {
  private generation = 0;
  private available = false;
  private pending: Promise<void> | null = null;
  private again = false;

  constructor(private readonly task: (current: () => boolean) => Promise<void>) {}

  setAvailable(available: boolean): void {
    this.generation++;
    this.available = available;
    this.again = false;
  }

  refresh = (): Promise<void> => {
    this.generation++;
    if (this.pending && this.available) this.again = true;
    return this.tick();
  };

  tick = (): Promise<void> => {
    if (!this.available) return Promise.resolve();
    if (this.pending) return this.pending;
    const ticket = this.generation;
    const current = () => this.available && ticket === this.generation;
    this.pending = Promise.resolve().then(() => current() ? this.task(current) : undefined).finally(() => {
      this.pending = null;
      if (this.again && this.available) {
        this.again = false;
        return this.tick();
      }
    });
    return this.pending;
  };
}
