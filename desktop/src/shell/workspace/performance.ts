// Opt in with localStorage.setItem("contextgit:performance", "1"). No timer or
// persistent profiler is installed during normal use. The ring cannot grow.
type Sample = { name: string; at: number; duration?: number };
const samples: Sample[] = [];
export function measure(name: string, start?: number) {
  if (localStorage.getItem("contextgit:performance") !== "1") return;
  const now = performance.now();
  samples.push({ name, at: now, ...(start === undefined ? {} : { duration: now - start }) });
  if (samples.length > 200) samples.shift();
  (window as Window & { contextgitPerformance?: Sample[] }).contextgitPerformance = samples;
}
