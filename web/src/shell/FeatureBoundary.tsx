import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import ErrorBoundary from "../ErrorBoundary";

export function FeatureError({ feature, error, retry }: { feature: string; error: Error; retry: () => void }) {
  return (
    <section className="cg-feature-error" role="alert" data-failed-feature={feature}>
      <h2>{feature} hit an error</h2>
      <pre>{error.message}</pre>
      <button type="button" className="cg-btn" onClick={retry}>Try again</button>
    </section>
  );
}

/** Evaluate a region inside its boundary, including its derived calculations. */
function Region({ render }: { render: () => ReactNode }) { return render(); }

export function FeatureRegion({ feature, render, onDismiss }: { feature: string; render: () => ReactNode; onDismiss?: () => void }) {
  return <ErrorBoundary feature={feature} fallback={onDismiss ? (error, retry) =>
    <div className="cg-feature-modal-error" role="dialog" aria-label={`${feature} error`}>
      <FeatureError feature={feature} error={error} retry={retry} />
      <button type="button" className="cg-btn" onClick={onDismiss}>Close error</button>
    </div> : undefined}><Region render={render} /></ErrorBoundary>;
}

/** A controller failure removes only its portals; the shell and sibling hosts survive. */
export function FeatureBoundary({ feature, target, children }: { feature: string; target: HTMLElement | null; children: ReactNode }) {
  return (
    <ErrorBoundary feature={feature} fallback={(error, retry) => target
      ? createPortal(<FeatureError feature={feature} error={error} retry={retry} />, target)
      : null}>
      {children}
    </ErrorBoundary>
  );
}
