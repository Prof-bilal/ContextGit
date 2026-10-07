import { useState } from "react";

import type { ApiClientState } from "../api/useApiClient";

/** Collections of saved requests, then the requests you already sent. */
export default function ApiRail({ client }: { client: ApiClientState }) {
  const {
    collections,
    history,
    activeCollection,
    loadCollection,
    saveCollection,
    deleteCollection,
    recall,
  } = client;
  const [name, setName] = useState("");

  return (
    <nav className="cg-rail" aria-label="API collections and history">
      <div className="cg-rail-head">
        <h2>Collections</h2>
        <span className="cg-count">{collections.length}</span>
      </div>
      {collections.length === 0 && (
        <p className="cg-empty-note">Nothing saved yet.</p>
      )}
      {collections.map((collection) => (
        <div className="cg-row-wrap" key={collection}>
          <button
            type="button"
            className="cg-row"
            aria-current={activeCollection === collection}
            onClick={() => void loadCollection(collection)}
          >
            <span className="cg-row-name">{collection}</span>
          </button>
          <button
            type="button"
            className="cg-row-delete"
            aria-label={`Delete collection ${collection}`}
            onClick={() => void deleteCollection(collection)}
          >
            ×
          </button>
        </div>
      ))}
      <form
        className="cg-api-save"
        onSubmit={(event) => {
          event.preventDefault();
          void saveCollection(name);
          setName("");
        }}
      >
        <input
          className="cg-input"
          aria-label="Collection name"
          placeholder="New collection"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <button
          type="submit"
          className="cg-btn cg-btn-sm"
          disabled={!name.trim()}
        >
          Save request
        </button>
      </form>

      <div className="cg-rail-head">
        <h2>History</h2>
        <span className="cg-count">{history.length}</span>
      </div>
      {history.length === 0 && (
        <p className="cg-empty-note">No requests sent yet.</p>
      )}
      {history.map((entry) => (
        <button
          type="button"
          className="cg-row"
          key={entry.id}
          onClick={() => recall(entry)}
          title="Load this request back into the editor"
        >
          <span className="cg-row-top">
            <span className="cg-mono">{entry.method}</span>
            <span className={entry.status >= 400 ? "cg-api-warn" : "cg-api-ok"}>
              {entry.status}
            </span>
          </span>
          <span className="cg-row-name">{entry.url}</span>
        </button>
      ))}
    </nav>
  );
}
