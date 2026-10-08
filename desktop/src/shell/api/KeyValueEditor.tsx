import type { HttpKeyValue } from "@/lib/api";

interface Props {
  rows: HttpKeyValue[];
  onChange: (rows: HttpKeyValue[]) => void;
  keyPlaceholder: string;
  valuePlaceholder: string;
  showEnabled?: boolean;
}

/** Editable rows of key/value pairs (query params, headers, form fields). */
export default function KeyValueEditor({
  rows,
  onChange,
  keyPlaceholder,
  valuePlaceholder,
  showEnabled = true,
}: Props) {
  const update = (index: number, patch: Partial<HttpKeyValue>) =>
    onChange(rows.map((row, at) => (at === index ? { ...row, ...patch } : row)));

  return (
    <div className="cg-api-kv">
      {rows.length === 0 ? (
        <p className="cg-empty-note">No rows yet — add one below.</p>
      ) : (
        <div className="cg-api-kv-head" data-enabled={showEnabled}>
          {showEnabled && <span aria-hidden="true" />}
          <span>Key</span>
          <span>Value</span>
          <span aria-hidden="true" />
        </div>
      )}
      {rows.map((row, index) => (
        <div className="cg-api-kv-row" data-enabled={showEnabled} key={index}>
          {showEnabled && (
            <input
              type="checkbox"
              checked={row.enabled}
              aria-label={`Enable row ${index + 1}`}
              onChange={(event) =>
                update(index, { enabled: event.target.checked })
              }
            />
          )}
          <input
            className="cg-input"
            value={row.name}
            placeholder={keyPlaceholder}
            aria-label={`${keyPlaceholder} ${index + 1}`}
            onChange={(event) => update(index, { name: event.target.value })}
          />
          <input
            className="cg-input"
            value={row.value}
            placeholder={valuePlaceholder}
            aria-label={`${valuePlaceholder} ${index + 1}`}
            onChange={(event) => update(index, { value: event.target.value })}
          />
          <button
            type="button"
            className="cg-btn cg-btn-sm cg-api-kv-del"
            aria-label={`Remove row ${index + 1}`}
            title="Remove row"
            onClick={() => onChange(rows.filter((_, at) => at !== index))}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="cg-btn cg-btn-sm cg-api-kv-add"
        onClick={() =>
          onChange([...rows, { name: "", value: "", enabled: true }])
        }
      >
        + Add row
      </button>
    </div>
  );
}
