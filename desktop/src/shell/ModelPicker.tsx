import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { LuCornerDownLeft, LuPlus } from "react-icons/lu";

import type { ProviderInfo } from "@/lib/api";
import { AgentMark, Chip } from "./primitives";
import { brandFor, type ModelSelection } from "./providers";

/**
 * Provider + model picker, driven by the backend registry. Providers on the
 * left, that provider's models on the right. A command-palette style dialog;
 * traps focus while open and returns it to the trigger on close.
 */
export default function ModelPicker({
  providers,
  selection,
  onSelect,
  onAddProvider,
  onClose,
}: {
  providers: ProviderInfo[];
  selection: ModelSelection;
  onSelect: (next: ModelSelection) => void;
  onAddProvider: () => void;
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
  const chatProviders = useMemo(
    () => providers.filter((provider) => provider.capability === "chat"),
    [providers],
  );
  const visible = useMemo(
    () =>
      chatProviders.filter(
        (provider) =>
          !needle ||
          provider.label.toLowerCase().includes(needle) ||
          provider.vendor.toLowerCase().includes(needle) ||
          provider.models.some((model) => model.toLowerCase().includes(needle)),
      ),
    [chatProviders, needle],
  );
  const activeProvider = useMemo(
    () => visible.find((provider) => provider.id === activeProviderId) ?? visible[0],
    [visible, activeProviderId],
  );
  const models = useMemo(
    () =>
      (activeProvider?.models ?? []).filter(
        (model) => !needle || model.toLowerCase().includes(needle),
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
      choose(activeProvider.id, models[cursor]);
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
            <div className="cg-picker-pane-head">
              <p className="cg-kicker">Providers</p>
              <button
                type="button"
                className="cg-chip cg-chip-btn"
                onClick={() => {
                  onClose();
                  onAddProvider();
                }}
              >
                <LuPlus aria-hidden="true" /> Add
              </button>
            </div>
            {visible.map((provider) => {
              const brand = brandFor(provider.id, provider.label);
              return (
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
                  <AgentMark agent={brand.hue} icon={brand.icon} label={brand.monogram} />
                  <span className="cg-picker-item-copy">
                    <span className="cg-picker-item-title">{provider.label}</span>
                    <span className="cg-picker-item-meta">
                      {provider.vendor || "custom"} · {provider.models.length} model
                      {provider.models.length === 1 ? "" : "s"}
                      {provider.key_hint ? ` · key ${provider.key_hint}` : ""}
                    </span>
                  </span>
                  {provider.kind === "local" && <Chip>local</Chip>}
                  {provider.kind === "mock" && <Chip>offline</Chip>}
                  {!provider.configured && <Chip tone="warn">needs key</Chip>}
                </button>
              );
            })}
            {visible.length === 0 && <p className="cg-empty-note">No providers match.</p>}
          </div>

          <div className="cg-picker-pane" aria-label="Models">
            <p className="cg-kicker">{activeProvider ? activeProvider.label : "Models"}</p>
            {models.map((model, index) => (
              <button
                key={model}
                type="button"
                className="cg-picker-item"
                aria-current={index === cursor}
                onMouseEnter={() => setCursor(index)}
                onClick={() => activeProvider && choose(activeProvider.id, model)}
              >
                <span className="cg-picker-item-copy">
                  <span className="cg-picker-item-title cg-mono">{model}</span>
                </span>
              </button>
            ))}
            {models.length === 0 && (
              <p className="cg-empty-note">
                {activeProvider
                  ? `No models listed for ${activeProvider.label}. Fetch them with “Add provider”.`
                  : "Choose a provider."}
              </p>
            )}
          </div>
        </div>

        <footer className="cg-picker-foot">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> navigate
          </span>
          <span>
            <kbd>
              <LuCornerDownLeft aria-hidden="true" />
            </kbd>{" "}
            select
          </span>
          <span>
            <kbd>esc</kbd> close
          </span>
          <span className="cg-toolbar-spacer" />
          <span className="cg-view-sub">
            Current: {chatProviders.find((p) => p.id === selection.providerId)?.label ?? "—"}
          </span>
        </footer>
      </div>
    </div>
  );
}
