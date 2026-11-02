import type { ReactNode } from "react";
import { LuX } from "react-icons/lu";

export function Dock({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <aside className="cg-dock" aria-label={`${title} inspector`}>
      <div className="cg-dock-head">
        <h2>{title}</h2>
        <span className="cg-toolbar-spacer" />
        <button
          type="button"
          className="cg-icon-btn"
          aria-label="Close inspector"
          title="Close inspector"
          onClick={onClose}
        >
          <LuX aria-hidden="true" />
        </button>
      </div>
      <div className="cg-dock-body">{children}</div>
    </aside>
  );
}
