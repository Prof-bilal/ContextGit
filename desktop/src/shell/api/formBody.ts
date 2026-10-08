import type { HttpKeyValue } from "@/lib/api";

/**
 * A `form` body is kept as `key=value&key2=value2` on the request spec — the
 * exact string the backend posts as `application/x-www-form-urlencoded`. These
 * helpers round-trip it to editable rows, blank rows included.
 */
export function parseForm(body: string): HttpKeyValue[] {
  if (!body) return [];
  return body.split("&").map((pair) => {
    const at = pair.indexOf("=");
    const name = at === -1 ? pair : pair.slice(0, at);
    const value = at === -1 ? "" : pair.slice(at + 1);
    return { name: decodePart(name), value: decodePart(value), enabled: true };
  });
}

export function serializeForm(rows: HttpKeyValue[]): string {
  return rows
    .map((row) => `${encodeURIComponent(row.name)}=${encodeURIComponent(row.value)}`)
    .join("&");
}

function decodePart(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value;
  }
}
