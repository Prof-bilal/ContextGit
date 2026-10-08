/** Vite's React refresh preamble needs inline scripts only in development. */
export function rendererCsp(development: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self'${development ? " 'unsafe-inline'" : ""}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' ctxasset: data: blob:",
    "media-src 'self' ctxasset: blob:",
    `connect-src 'self' http://127.0.0.1:* http://localhost:*${development ? " ws://127.0.0.1:* ws://localhost:*" : ""}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join("; ");
}
