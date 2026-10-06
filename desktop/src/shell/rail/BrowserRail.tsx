/** The Browser rail: bookmarks that open in the in-app browser. */
export default function BrowserRail({ onOpen }: { onOpen: (url: string) => void }) {
  const bookmarks: Array<{ label: string; url: string }> = [
    { label: "Google", url: "https://www.google.com" },
    { label: "GitHub", url: "https://github.com" },
    { label: "Stack Overflow", url: "https://stackoverflow.com" },
    { label: "MDN", url: "https://developer.mozilla.org" },
    { label: "npm", url: "https://www.npmjs.com" },
    { label: "ChatGPT", url: "https://chatgpt.com" },
    { label: "Claude", url: "https://claude.ai" },
    { label: "Gemini", url: "https://gemini.google.com" },
    { label: "YouTube", url: "https://www.youtube.com" },
  ];

  return (
    <nav className="cg-rail" aria-label="Browser">
      <div className="cg-rail-head">
        <h2>Bookmarks</h2>
      </div>
      {bookmarks.map((bookmark) => (
        <button
          key={bookmark.url}
          type="button"
          className="cg-row"
          title={bookmark.url}
          onClick={() => onOpen(bookmark.url)}
        >
          <span className="cg-row-title">{bookmark.label}</span>
        </button>
      ))}
      <p className="cg-empty-note cg-rail-search">
        Any http(s) site opens in-app. Camera, microphone, location and notifications are blocked.
      </p>
    </nav>
  );
}
