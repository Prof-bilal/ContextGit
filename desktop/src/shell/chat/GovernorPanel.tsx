import { useState } from "react";

import { GOVERNOR_RECEIPTS } from "../../mock/chat";

const TONE = { kept: "ok", dropped: "warn", "dead-end": "bad" } as const;

/**
 * Context governor: how full the context is, what got compacted, and receipts for
 * every drop — with pins the user controls. Dead ends are never dropped.
 */
export default function GovernorPanel({ used, budget }: { used: number; budget: number }) {
  const [items, setItems] = useState(GOVERNOR_RECEIPTS);
  const ratio = used / budget;

  const pin = (id: string, pinned: boolean) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, pinned } : item)));
  };

  return (
    <section className="cg-governor" aria-label="Context governor">
      <header className="cg-block-head">
        <span className="cg-kicker">Context governor</span>
        <span className="cg-view-sub">
          {(used / 1000).toFixed(1)}k / {(budget / 1000).toFixed(0)}k
        </span>
      </header>

      <div className="cg-burn">
        <div
          className="cg-burn-bar"
          data-tone={ratio > 0.85 ? "bad" : ratio > 0.6 ? "warn" : undefined}
        >
          <span style={{ width: `${Math.min(100, ratio * 100)}%` }} />
        </div>
      </div>

      <ul className="cg-receipts" aria-label="Compaction receipts">
        {items.map((item) => (
          <li key={item.id} className="cg-receipt" data-kind={item.kind}>
            <span className="cg-receipt-kind">{item.kind === "dead-end" ? "dead end" : item.kind}</span>
            <span className="cg-receipt-copy">
              <strong>{item.text}</strong>
              <span>{item.reason}</span>
            </span>
            {item.kind === "dead-end" ? (
              <span className="cg-receipt-lock" title="Dead ends are never dropped">
                locked
              </span>
            ) : (
              <label className="cg-pin">
                <input
                  type="checkbox"
                  checked={item.pinned}
                  onChange={(event) => pin(item.id, event.target.checked)}
                />
                pin
              </label>
            )}
          </li>
        ))}
      </ul>

      <div className="cg-tags">
        <span className="cg-chip">{items.filter((item) => item.kind === "kept").length} kept</span>
        <span className="cg-chip">{items.filter((item) => item.kind === "dropped").length} dropped</span>
        <span className="cg-chip" data-tone="bad">
          1 dead end (locked)
        </span>
      </div>
      <p className="cg-empty-note" style={{ marginTop: "0" }}>
        Every drop is listed with its reason; pinning keeps an item through the next compaction.
      </p>
    </section>
  );
}
