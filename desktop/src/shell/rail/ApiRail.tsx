import { useState } from "react";
import { LuFolder, LuTrash2 } from "react-icons/lu";

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
    <nav
      className="cg-rail cg-api-rail"
      aria-label="API collections and history"
    >
      <div className="cg-rail-head">
        <h2>Collections</h2>
        <span className="cg-count">{collections.length}</span>
      </div>

      <div className="cg-api-group">
        {collections.length === 0 ? (
          <p className="cg-empty-note">
            Nothing saved yet — name a collection below.
          </p>
        ) : (
          collections.map((collection) => (
            <div className="cg-row-wrap cg-api-collection" key={collection}>
              <button
                type="button"
                className="cg-row"
                aria-current={activeCollection === collection}
                onClick={() => void loadCollection(collection)}
              >
                <LuFolder
                  className="cg-api-collection-icon"
                  aria-hidden="true"
                />
                <span className="cg-row-name">{collection}</span>
              </button>
              <button
                type="button"
                className="cg-row-delete"
                aria-label={`Delete collection ${collection}`}
                title="Delete collection"
                onClick={() => void deleteCollection(collection)}
              >
                <LuTrash2 aria-hidden="true" />
              </button>
            </div>
          ))
        )}
      </div>

      <form
        className="cg-api-save"
        onSubmit={(event) => {
          event.preventDefault();
          void saveCollection(name);
          setName("");
        }}
      >
        <p className="cg-api-save-title">Save current request</p>
        <input
          className="cg-input"
          aria-label="Collection name"
          placeholder="Collection name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <button
          type="submit"
          className="cg-btn cg-btn-sm cg-api-save-btn"
          disabled={!name.trim()}
        >
          Save request
        </button>
      </form>

      <div className="cg-rail-head">
        <h2>History</h2>
        <span className="cg-count">{history.length}</span>
      </div>

      <div className="cg-api-group">
        {history.length === 0 ? (
          <p className="cg-empty-note">No requests sent yet.</p>
        ) : (
          history.map((entry) => (
            <button
              type="button"
              className="cg-row cg-api-history"
              key={entry.id}
              onClick={() => recall(entry)}
              title="Load this request back into the editor"
            >
              <span className="cg-api-history-head">
                <span className="cg-api-method-chip" data-method={entry.method}>
                  {entry.method}
                </span>
                <span
                  className={`cg-api-history-status ${
                    entry.status >= 400 ? "cg-api-warn" : "cg-api-ok"
                  }`}
                >
                  {entry.status}
                </span>
              </span>
              <span className="cg-api-history-url">{entry.url}</span>
            </button>
          ))
        )}
      </div>
    </nav>
  );
}
