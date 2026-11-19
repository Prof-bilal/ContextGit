/** Keep one identity per run. Prefer the most recently updated duplicate. */
export function uniqueSessions<T extends { id: string; updated_at?: string }>(values: T[]): T[] {
  const result = new Map<string, T>();
  for (const value of values) {
    const previous = result.get(value.id);
    if (!previous || (value.updated_at ?? "") >= (previous.updated_at ?? "")) result.set(value.id, value);
  }
  if (result.size !== values.length) console.warn("Duplicate session IDs received", values.length - result.size);
  return [...result.values()];
}

/** Both response ordering and completed writes invalidate an old snapshot. */
export class SessionRevision {
  private request = 0;
  private mutation = 0;
  begin(): { request: number; mutation: number } {
    return { request: ++this.request, mutation: this.mutation };
  }
  changed(): void { this.mutation++; }
  accepts(ticket: { request: number; mutation: number }): boolean {
    return ticket.request === this.request && ticket.mutation === this.mutation;
  }
}
