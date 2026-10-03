import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { Chip, Monogram } from "./primitives";
import { PROVIDERS, type ModelSelection } from "./providers";

/**
 * Provider + model picker. A command-palette style dialog: providers on the
 * left, that provider's models on the right, one search box driving both.
 * Traps focus while open and returns it to the trigger on close.
 */
export default function ModelPicker({
  selection,
  onSelect,
  onClose,
}: {
  selection: ModelSelection;
  onSelect: (next: ModelSelection) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [activeProviderId, setActiveProviderId] = useState(selection.providerId);
  const [cursor, setCursor] = useState(0);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restoreRef.current = document.activeElement as HTMLElement | null;
    searchRef.current?.focus();
    return () => restoreRef.current?.focus?.();
  }, []);

  const needle = query.trim().toLowerCase();
  const providers = useMemo(
    () =>
      PROVIDERS.filter(
        (provider) =>
          !needle ||
          provider.label.toLowerCase().includes(needle) ||
          provider.models.some((model) => model.label.toLowerCase().includes(needle)),
      ),
    [needle],
  );
  const activeProvider = useMemo(
    () => providers.find((provider) => provider.id === activeProviderId) ?? providers[0],
    [providers, activeProviderId],
  );
  const models = useMemo(
    () =>
      (activeProvider?.models ?? []).filter(
        (model) => !needle || model.label.toLowerCase().includes(needle) || model.id.includes(needle),
      ),
    [activeProvider, needle],
  );

  useEffect(() => {
    setCursor(0);
  }, [activeProviderId, needle]);

  const choose = (providerId: string, modelId: string) => {
    onSelect({ providerId, modelId });
    onClose();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "Tab") {
      // Keep focus inside the dialog.
      const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (models.length === 0) return;
      event.preventDefault();
      setCursor((current) => {
        const next = event.key === "ArrowDown" ? current + 1 : current - 1;
        return (next + models.length) % models.length;
      });
      return;
    }
    if (event.key === "Enter" && activeProvider && models[cursor]) {
      event.preventDefault();
      choose(activeProvider.id, models[cursor].id);
    }
  };

  return (
    <div className="cg-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="cg-modal cg-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cg-picker-title"
        ref={dialogRef}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <header className="cg-picker-head">
          <h2 id="cg-picker-title">Choose a model</h2>
          <span className="cg-toolbar-spacer" />
          <input
            ref={searchRef}
            className="cg-picker-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search providers and models"
            aria-label="Search providers and models"
          />
        </header>

        <div className="cg-picker-body">
          <div className="cg-picker-pane" aria-label="Providers">
            <p className="cg-kicker">Providers</p>
            {providers.map((provider) => (
              <button
                key={provider.id}
                type="button"
                className="cg-picker-item"
                aria-current={provider.id === activeProvider?.id}
                onClick={() => {
                  setActiveProviderId(provider.id);
                  searchRef.current?.focus();
                }}
              >
                <Monogram agent={provider.hue} label={provider.monogram} />
                <span className="cg-picker-item-copy">
                  <span className="cg-picker-item-title">{provider.label}</span>
                  <span className="cg-picker-item-meta">
                    {provider.vendor} · {provider.models.length} model
                    {provider.models.length === 1 ? "" : "s"}
                  </span>
                </span>
                {provider.kind === "local" && <Chip>local</Chip>}
              </button>
            ))}
            {providers.length === 0 && <p className="cg-empty-note">No providers match.</p>}
          </div>

          <div className="cg-picker-pane" aria-label="Models">
            <p className="cg-kicker">{activeProvider ? activeProvider.label : "Models"}</p>
            {models.map((model, index) => (
              <button
                key={model.id}
                type="button"
                className="cg-picker-item"
                aria-current={index === cursor}
                onMouseEnter={() => setCursor(index)}
                onClick={() => activeProvider && choose(activeProvider.id, model.id)}
              >
                <span className="cg-picker-item-copy">
                  <span className="cg-picker-item-title">{model.label}</span>
                  <span className="cg-picker-item-meta">
                    <span className="cg-mono">{model.id}</span>
                    {model.context ? ` · ${model.context}` : ""}
                  </span>
                </span>
                {model.note && <Chip>{model.note}</Chip>}
              </button>
            ))}
            {models.length === 0 && (
              <p className="cg-empty-note">No models match “{query.trim()}”.</p>
            )}
          </div>
        </div>

        <footer className="cg-picker-foot">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> navigate
          </span>
          <span>
            <kbd>⏎</kbd> select
          </span>
          <span>
            <kbd>esc</kbd> close
          </span>
          <span className="cg-toolbar-spacer" />
          <span className="cg-view-sub">
            Current: {PROVIDERS.find((p) => p.id === selection.providerId)?.label ?? "—"}
          </span>
        </footer>
      </div>
    </div>
  );
}
