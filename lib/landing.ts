/* Shared demo data and hashing helpers, ported 1:1 from landing/script.js. */

export const SVG_NS = "http://www.w3.org/2000/svg";

export const LANES: Record<string, number> = { main: 44, redis: 104, memory: 164 };

export interface Commit {
  id: string;
  b: "main" | "redis" | "memory";
  x: number;
  kind: "root" | "normal" | "merge" | "note";
  parents: string[];
  title: string;
  summary: string;
  tokens: string;
  model: string;
}

export const COMMITS: Commit[] = [
  { id: 'a3f9c21', b: 'main', x: 60, kind: 'root', parents: [], title: 'Start the design chat', summary: 'System prompt and the first question: design a rate limiter for a public API.', tokens: '212', model: 'example-model' },
  { id: '7be04d8', b: 'main', x: 170, kind: 'normal', parents: ['a3f9c21'], title: 'Spec the limit', summary: 'Decided on 100 requests per minute per API key, with a short burst allowance.', tokens: '640', model: 'example-model' },
  { id: '1d6c9a0', b: 'main', x: 280, kind: 'normal', parents: ['7be04d8'], title: 'Compare storage options', summary: 'Listed where counters could live. Two candidates worth trying. This is the branch point.', tokens: '1,440', model: 'example-model' },
  { id: '5d2f8e1', b: 'main', x: 480, kind: 'normal', parents: ['1d6c9a0'], title: 'Add audit logging', summary: 'Decided to log every allow and deny decision for audit.', tokens: '1,916', model: 'example-model' },
  { id: 'f10c7a6', b: 'main', x: 700, kind: 'merge', parents: ['5d2f8e1', '4c07a1e'], title: 'Merge redis-bucket', summary: 'Token bucket in Redis, 50 ms skew tolerated, dead end recorded. One conflict resolved by hand.', tokens: '2,318', model: 'example-model' },
  { id: '9e41b7d', b: 'redis', x: 390, kind: 'normal', parents: ['1d6c9a0'], title: 'Redis token bucket', summary: 'Token bucket in Redis, one Lua call per request. Atomic per key.', tokens: '2,104', model: 'example-model' },
  { id: '4c07a1e', b: 'redis', x: 560, kind: 'normal', parents: ['9e41b7d'], title: 'Cross-region clock skew', summary: 'Refill reads Redis server time. Skew up to 50 ms is tolerated. Counters only, no per-request logging.', tokens: '4,632', model: 'example-model' },
  { id: 'b82e5c3', b: 'memory', x: 390, kind: 'normal', parents: ['1d6c9a0'], title: 'In-process counters', summary: 'Per-node counters with periodic sync. Fast, but limits drift across nodes.', tokens: '1,860', model: 'example-model' },
  { id: 'e3a9d04', b: 'memory', x: 500, kind: 'note', parents: ['b82e5c3'], title: 'Dead end: fails on failover', summary: 'Counters reset when a node restarts, so a failover grants a fresh burst. Abandoned.', tokens: '2,250', model: 'example-model' },
];

export const BRANCH_NAME: Record<string, string> = { main: 'main', redis: 'redis-bucket', memory: 'in-memory' };

export const BRANCH_LABEL = [
  { b: 'main', x: 115, y: 18, text: 'main' },
  { b: 'redis', x: 475, y: 128, text: 'redis-bucket' },
  { b: 'memory', x: 524, y: 168, text: 'in-memory', start: true },
];

export const byId = Object.fromEntries(COMMITS.map((c) => [c.id, c])) as Record<string, Commit>;

export const pos = (c: Commit) => ({ x: c.x, y: LANES[c.b] });

export const edgePath = (from: Commit, to: Commit) => {
  const a = pos(from);
  const b = pos(to);
  if (a.y === b.y) return `M${a.x} ${a.y} L${b.x} ${b.y}`;
  const mid = a.x + (b.x - a.x) / 2;
  return `M${a.x} ${a.y} C${mid} ${a.y} ${mid} ${b.y} ${b.x} ${b.y}`;
};

/* ---------- SHA-256 (same algorithm as script.js) ---------- */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export const sha256 = (bytes: Uint8Array) => {
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const bitLen = bytes.length * 8;
  const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  view.setUint32(padded.length - 4, bitLen >>> 0);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, '0')).join('');
};

const escapeJson = (s: string) => JSON.stringify(s);

export const canonicalCommit = (content: string) =>
  '{"messages":[{"content":' + escapeJson(content) + ',"role":"user"}],'
  + '"metadata":{"kind":"normal","model":"example-model"},'
  + '"parent_ids":["a3f9c21"]}';
