import { useState } from "react";

import type { HttpAuthKind, HttpBodyKind, HttpResponseResult } from "@/lib/api";
import KeyValueEditor from "../api/KeyValueEditor";
import type { ApiClientState } from "../api/useApiClient";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

const BODY_KINDS: Array<{ id: HttpBodyKind; label: string }> = [
  { id: "none", label: "None" },
  { id: "json", label: "JSON" },
  { id: "text", label: "Text" },
  { id: "form", label: "Form" },
];

const AUTH_KINDS: Array<{ id: HttpAuthKind; label: string }> = [
  { id: "none", label: "No auth" },
  { id: "bearer", label: "Bearer token" },
  { id: "basic", label: "Basic (user:pass)" },
  { id: "api-key", label: "X-API-Key" },
];

type RequestPane = "params" | "headers" | "body" | "auth";

function statusTone(status: number): string {
  if (status >= 500) return "cg-api-bad";
  if (status >= 400) return "cg-api-warn";
  return "cg-api-ok";
}

function prettyBody(result: HttpResponseResult): string {
  const type = result.headers["content-type"] ?? "";
  if (!type.includes("json")) return result.body;
  try {
    return JSON.stringify(JSON.parse(result.body), null, 2);
  } catch {
    return result.body;
  }
}

/** The API tab: compose a request on top, read the response underneath. */
export default function ApiView({ client }: { client: ApiClientState }) {
  const [pane, setPane] = useState<RequestPane>("params");
  const [responsePane, setResponsePane] = useState<"body" | "headers">("body");
  const { spec, patchSpec, response, sending, error, send } = client;

  return (
    <div className="cg-view" data-active="true">
      <div className="cg-view-body cg-api">
        <div className="cg-api-bar">
          <select
            className="cg-input cg-api-method"
            aria-label="HTTP method"
            value={spec.method}
            onChange={(event) => patchSpec({ method: event.target.value })}
          >
            {METHODS.map((method) => (
              <option key={method} value={method}>
                {method}
              </option>
            ))}
          </select>
          <input
            className="cg-input cg-api-url"
            aria-label="Request URL"
            placeholder="https://api.example.com/things"
            value={spec.url}
            onChange={(event) => patchSpec({ url: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Enter") void send();
            }}
          />
          <button
            type="button"
            className="cg-btn"
            data-variant="primary"
            disabled={sending || !spec.url.trim()}
            onClick={() => void send()}
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>

        <nav className="cg-segmented" aria-label="Request parts">
          {(["params", "headers", "body", "auth"] as RequestPane[]).map(
            (id) => (
              <button
                key={id}
                type="button"
                className="cg-segment"
                aria-selected={pane === id}
                onClick={() => setPane(id)}
              >
                {id === "auth" ? "Auth" : id[0].toUpperCase() + id.slice(1)}
              </button>
            ),
          )}
        </nav>

        <div className="cg-api-editor">
          {pane === "params" && (
            <KeyValueEditor
              rows={spec.params}
              onChange={(params) => patchSpec({ params })}
              keyPlaceholder="param"
              valuePlaceholder="value"
            />
          )}
          {pane === "headers" && (
            <KeyValueEditor
              rows={spec.headers}
              onChange={(headers) => patchSpec({ headers })}
              keyPlaceholder="header"
              valuePlaceholder="value"
            />
          )}
          {pane === "body" && (
            <div className="cg-api-body">
              <select
                className="cg-input"
                aria-label="Body kind"
                value={spec.body_kind}
                onChange={(event) =>
                  patchSpec({ body_kind: event.target.value as HttpBodyKind })
                }
              >
                {BODY_KINDS.map((kind) => (
                  <option key={kind.id} value={kind.id}>
                    {kind.label}
                  </option>
                ))}
              </select>
              <textarea
                className="cg-input cg-api-textarea"
                aria-label="Request body"
                placeholder={
                  spec.body_kind === "json" ? '{ "name": "widget" }' : ""
                }
                value={spec.body}
                disabled={spec.body_kind === "none"}
                onChange={(event) => patchSpec({ body: event.target.value })}
              />
            </div>
          )}
          {pane === "auth" && (
            <div className="cg-api-body">
              <select
                className="cg-input"
                aria-label="Auth kind"
                value={spec.auth_kind}
                onChange={(event) =>
                  patchSpec({ auth_kind: event.target.value as HttpAuthKind })
                }
              >
                {AUTH_KINDS.map((kind) => (
                  <option key={kind.id} value={kind.id}>
                    {kind.label}
                  </option>
                ))}
              </select>
              <input
                className="cg-input"
                type="password"
                aria-label="Auth value"
                placeholder="token or user:password"
                value={spec.auth_value}
                disabled={spec.auth_kind === "none"}
                onChange={(event) =>
                  patchSpec({ auth_value: event.target.value })
                }
              />
            </div>
          )}
        </div>

        {error && <p className="cg-api-error">{error}</p>}

        <section className="cg-api-response" aria-live="polite">
          {response ? (
            <>
              <div className="cg-api-status">
                <span className={`cg-api-code ${statusTone(response.status)}`}>
                  {response.status} {response.reason}
                </span>
                <span className="cg-view-sub">
                  {response.elapsed_ms} ms · {response.size} bytes
                  {response.truncated ? " · truncated" : ""}
                </span>
                <span className="cg-view-sub cg-mono">{response.url}</span>
              </div>
              <nav className="cg-segmented" aria-label="Response parts">
                <button
                  type="button"
                  className="cg-segment"
                  aria-selected={responsePane === "body"}
                  onClick={() => setResponsePane("body")}
                >
                  Body
                </button>
                <button
                  type="button"
                  className="cg-segment"
                  aria-selected={responsePane === "headers"}
                  onClick={() => setResponsePane("headers")}
                >
                  Headers
                </button>
              </nav>
              {responsePane === "body" ? (
                <pre className="cg-api-pre">{prettyBody(response)}</pre>
              ) : (
                <pre className="cg-api-pre">
                  {Object.entries(response.headers)
                    .map(([key, value]) => `${key}: ${value}`)
                    .join("\n")}
                </pre>
              )}
            </>
          ) : (
            <p className="cg-empty-note">
              {sending
                ? "Sending the request…"
                : "Send a request to see the response."}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
