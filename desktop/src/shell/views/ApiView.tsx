import { useEffect, useRef, useState } from "react";

import type { HttpAuthKind, HttpBodyKind, HttpResponseResult } from "@/lib/api";
import CodeEditor, { type CodeEditorHandle } from "../api/CodeEditor";
import { parseForm, serializeForm } from "../api/formBody";
import KeyValueEditor from "../api/KeyValueEditor";
import type { ApiClientState } from "../api/useApiClient";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

const BODY_KINDS: Array<{ id: HttpBodyKind; label: string }> = [
  { id: "none", label: "None" },
  { id: "json", label: "JSON" },
  { id: "text", label: "Text" },
  { id: "form", label: "Form" },
];

const AUTH_KINDS: Array<{
  id: HttpAuthKind;
  label: string;
  hint: string;
  placeholder: string;
}> = [
  {
    id: "none",
    label: "No auth",
    hint: "No authorization header is sent.",
    placeholder: "",
  },
  {
    id: "bearer",
    label: "Bearer token",
    hint: "Sent as Authorization: Bearer <token>.",
    placeholder: "eyJhbGciOiJIUzI1NiIs…",
  },
  {
    id: "basic",
    label: "Basic auth",
    hint: "Sent as Authorization: Basic <base64(user:pass)>.",
    placeholder: "user:password",
  },
  {
    id: "api-key",
    label: "API key",
    hint: "Sent as the X-API-Key header.",
    placeholder: "sk-live-…",
  },
  {
    id: "cookie",
    label: "Cookie",
    hint: "Sent as the Cookie header.",
    placeholder: "session=abc123; theme=dark",
  },
];

/** A cookie the user chose to keep, so it survives reloads. */
const COOKIE_KEY = "cg.api.cookie";

function readSavedCookie(): string {
  try {
    return localStorage.getItem(COOKIE_KEY) ?? "";
  } catch {
    return "";
  }
}

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
  const [markers, setMarkers] = useState({ errors: 0, warnings: 0 });
  const editorRef = useRef<CodeEditorHandle | null>(null);
  const { spec, patchSpec, response, sending, error, send } = client;

  const [savedCookie, setSavedCookie] = useState(readSavedCookie);
  const activeAuth =
    AUTH_KINDS.find((kind) => kind.id === spec.auth_kind) ?? AUTH_KINDS[0];
  const cookieSaved =
    spec.auth_value.trim() !== "" && spec.auth_value === savedCookie;
  const saveCookie = () => {
    try {
      localStorage.setItem(COOKIE_KEY, spec.auth_value);
    } catch {
      // Storage can be unavailable; the cookie still sends for this session.
    }
    setSavedCookie(spec.auth_value);
  };

  // Monaco's diagnostics belong to the previous model, so drop them on switch.
  useEffect(() => {
    setMarkers({ errors: 0, warnings: 0 });
  }, [spec.body_kind]);

  const enabledCount = (rows: typeof spec.params) =>
    rows.filter((row) => row.enabled && row.name).length;

  const panes: Array<{ id: RequestPane; label: string; count: number }> = [
    { id: "params", label: "Params", count: enabledCount(spec.params) },
    { id: "headers", label: "Headers", count: enabledCount(spec.headers) },
    { id: "body", label: "Body", count: spec.body_kind === "none" ? 0 : 1 },
    { id: "auth", label: "Auth", count: spec.auth_kind === "none" ? 0 : 1 },
  ];

  const showCode = spec.body_kind === "json" || spec.body_kind === "text";

  return (
    <div className="cg-view" data-active="true">
      <div className="cg-view-body cg-api">
        <section className="cg-api-request">
          <div className="cg-api-bar">
            <select
              className="cg-api-method"
              data-method={spec.method}
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
              spellCheck={false}
              value={spec.url}
              onChange={(event) => patchSpec({ url: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Enter") void send();
              }}
            />
            <button
              type="button"
              className="cg-btn cg-btn-send"
              data-variant="primary"
              disabled={sending || !spec.url.trim()}
              onClick={() => void send()}
            >
              {sending ? "Sending…" : "Send"}
            </button>
          </div>

          <nav className="cg-api-tabs" role="tablist" aria-label="Request parts">
            {panes.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                className="cg-api-tab"
                aria-selected={pane === item.id}
                onClick={() => setPane(item.id)}
              >
                {item.label}
                {item.count > 0 && (
                  <span className="cg-api-tab-count">{item.count}</span>
                )}
              </button>
            ))}
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
                <div className="cg-pills" role="tablist" aria-label="Body kind">
                  {BODY_KINDS.map((kind) => (
                    <button
                      key={kind.id}
                      type="button"
                      role="tab"
                      className="cg-pill"
                      aria-selected={spec.body_kind === kind.id}
                      onClick={() => patchSpec({ body_kind: kind.id })}
                    >
                      {kind.label}
                    </button>
                  ))}
                </div>
                {spec.body_kind === "none" ? (
                  <p className="cg-empty-note">This request has no body.</p>
                ) : spec.body_kind === "form" ? (
                  <KeyValueEditor
                    rows={parseForm(spec.body)}
                    onChange={(rows) => patchSpec({ body: serializeForm(rows) })}
                    keyPlaceholder="field"
                    valuePlaceholder="value"
                    showEnabled={false}
                  />
                ) : (
                  <div className="cg-code-block">
                    <div className="cg-code-bar">
                      {spec.body_kind === "json" && spec.body.trim() ? (
                        markers.errors > 0 ? (
                          <span className="cg-api-bad">
                            {markers.errors} error
                            {markers.errors > 1 ? "s" : ""}
                          </span>
                        ) : markers.warnings > 0 ? (
                          <span className="cg-api-warn">
                            {markers.warnings} warning
                            {markers.warnings > 1 ? "s" : ""}
                          </span>
                        ) : (
                          <span className="cg-api-ok">Valid JSON</span>
                        )
                      ) : null}
                      <span className="cg-toolbar-spacer" />
                      <button
                        type="button"
                        className="cg-btn cg-btn-sm"
                        onClick={() => editorRef.current?.format()}
                      >
                        Format
                      </button>
                    </div>
                    <CodeEditor
                      ref={editorRef}
                      value={spec.body}
                      language={
                        spec.body_kind === "json" ? "json" : "plaintext"
                      }
                      wordWrap={spec.body_kind === "text"}
                      placeholder={
                        spec.body_kind === "json"
                          ? '{ "name": "widget" }'
                          : "Write a text body…"
                      }
                      onChange={(body) => patchSpec({ body })}
                      onMarkers={
                        showCode && spec.body_kind === "json"
                          ? (errors, warnings) => setMarkers({ errors, warnings })
                          : undefined
                      }
                    />
                  </div>
                )}
              </div>
            )}
            {pane === "auth" && (
              <div className="cg-api-auth">
                <label className="cg-api-field">
                  <span className="cg-api-label">Type</span>
                  <select
                    className="cg-input"
                    aria-label="Auth kind"
                    value={spec.auth_kind}
                    onChange={(event) => {
                      const kind = event.target.value as HttpAuthKind;
                      patchSpec({
                        auth_kind: kind,
                        // Pull in the kept cookie the first time it's selected.
                        auth_value:
                          kind === "cookie" && !spec.auth_value
                            ? savedCookie
                            : spec.auth_value,
                      });
                    }}
                  >
                    {AUTH_KINDS.map((kind) => (
                      <option key={kind.id} value={kind.id}>
                        {kind.label}
                      </option>
                    ))}
                  </select>
                </label>

                {spec.auth_kind !== "none" && (
                  <label className="cg-api-field">
                    <span className="cg-api-label">
                      {spec.auth_kind === "cookie" ? "Cookie" : "Value"}
                    </span>
                    {spec.auth_kind === "cookie" ? (
                      <textarea
                        className="cg-input cg-api-auth-cookie"
                        aria-label="Auth value"
                        placeholder={activeAuth.placeholder}
                        value={spec.auth_value}
                        onChange={(event) =>
                          patchSpec({ auth_value: event.target.value })
                        }
                      />
                    ) : (
                      <input
                        className="cg-input"
                        type="password"
                        aria-label="Auth value"
                        placeholder={activeAuth.placeholder}
                        value={spec.auth_value}
                        onChange={(event) =>
                          patchSpec({ auth_value: event.target.value })
                        }
                      />
                    )}
                  </label>
                )}

                <p className="cg-api-hint">{activeAuth.hint}</p>

                {spec.auth_kind === "cookie" && (
                  <div className="cg-api-cookie-actions">
                    <button
                      type="button"
                      className="cg-btn cg-btn-sm"
                      disabled={!spec.auth_value.trim()}
                      onClick={saveCookie}
                    >
                      Save cookie
                    </button>
                    <span
                      className={`cg-api-cookie-state${
                        cookieSaved ? " cg-api-ok" : ""
                      }`}
                    >
                      {cookieSaved
                        ? "Saved — reused on new requests"
                        : savedCookie
                          ? "Not saved"
                          : "No saved cookie"}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

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
              <nav
                className="cg-api-tabs"
                role="tablist"
                aria-label="Response parts"
              >
                <button
                  type="button"
                  role="tab"
                  className="cg-api-tab"
                  aria-selected={responsePane === "body"}
                  onClick={() => setResponsePane("body")}
                >
                  Body
                </button>
                <button
                  type="button"
                  role="tab"
                  className="cg-api-tab"
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
