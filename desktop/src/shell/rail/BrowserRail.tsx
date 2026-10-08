import { LuTrash2 } from "react-icons/lu";

import { clearHistory, removeBookmark, useBrowserLibrary } from "../browser/library";

/** The Browser rail: bookmarks you've starred, then what you've visited. */
export default function BrowserRail({ onOpen }: { onOpen: (url: string) => void }) {
  const { history, bookmarks } = useBrowserLibrary();

  return (
    <nav className="cg-rail cg-browser-rail" aria-label="Browser">
      <div className="cg-rail-head">
        <h2>Bookmarks</h2>
        <span className="cg-count">{bookmarks.length}</span>
      </div>
      <div className="cg-br-group">
        {bookmarks.length === 0 ? (
          <p className="cg-empty-note">Star a page to keep it here.</p>
        ) : (
          bookmarks.map((entry) => (
            <div className="cg-row-wrap" key={entry.url}>
              <button
                type="button"
                className="cg-row"
                title={entry.url}
                onClick={() => onOpen(entry.url)}
              >
                <span className="cg-row-name">{entry.title}</span>
              </button>
              <button
                type="button"
                className="cg-row-delete"
                aria-label={`Remove bookmark ${entry.title}`}
                title="Remove bookmark"
                onClick={() => removeBookmark(entry.url)}
              >
                <LuTrash2 aria-hidden="true" />
              </button>
            </div>
          ))
        )}
      </div>

      <div className="cg-rail-head cg-br-divider">
        <h2>History</h2>
        <span className="cg-count">{history.length}</span>
        {history.length > 0 && (
          <button type="button" className="cg-btn cg-btn-sm" onClick={clearHistory}>
            Clear
          </button>
        )}
      </div>
      <div className="cg-br-group">
        {history.length === 0 ? (
          <p className="cg-empty-note">Pages you visit show up here.</p>
        ) : (
          history.slice(0, 60).map((entry) => (
            <button
              type="button"
              className="cg-row cg-br-history"
              key={`${entry.url}-${entry.at}`}
              title={entry.url}
              onClick={() => onOpen(entry.url)}
            >
              <span className="cg-br-title">{entry.title}</span>
              <span className="cg-br-url">{entry.url}</span>
            </button>
          ))
        )}
      </div>

      <p className="cg-br-note">
        Camera, microphone, location and notifications are blocked on every page.
      </p>
    </nav>
  );
}
