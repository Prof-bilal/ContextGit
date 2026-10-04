import type { ProviderCapability, ProviderInfo } from "@/lib/api";

import { AgentMark } from "../primitives";
import { brandFor } from "../providers";
import { RECOMMENDED } from "./providerStatus";

/**
 * The prompt shown when a mode has no usable provider: ask for a key rather than
 * silently answer with a mock. "Continue offline" is the deliberate escape hatch.
 */
export default function ConnectProviderCard({
  capability,
  title,
  message,
  providers,
  onAddProvider,
  onUseOffline,
}: {
  capability: ProviderCapability;
  title: string;
  message: string;
  providers: ProviderInfo[];
  onAddProvider: (capability: ProviderCapability, initialId?: string) => void;
  onUseOffline: () => void;
}) {
  const recommended = RECOMMENDED[capability]
    .map((id) => providers.find((provider) => provider.id === id))
    .filter((provider): provider is ProviderInfo => provider !== undefined);

  return (
    <section className="cg-connect" aria-label={title}>
      <span className="cg-connect-mark" aria-hidden="true">
        🔑
      </span>
      <h2>{title}</h2>
      <p>{message}</p>

      {recommended.length > 0 && (
        <div className="cg-tags" role="group" aria-label={`Recommended ${capability} providers`}>
          {recommended.map((provider) => {
            const brand = brandFor(provider.id, provider.label);
            return (
              <button
                key={provider.id}
                type="button"
                className="cg-chip cg-chip-btn"
                onClick={() => onAddProvider(capability, provider.id)}
              >
                <AgentMark agent={brand.hue} icon={brand.icon} label={brand.monogram} />
                {provider.label}
              </button>
            );
          })}
        </div>
      )}

      <div className="cg-dock-actions">
        <button
          type="button"
          className="cg-btn"
          data-variant="primary"
          onClick={() => onAddProvider(capability)}
        >
          Add an API key…
        </button>
        <button type="button" className="cg-btn" onClick={onUseOffline}>
          Continue offline (mock)
        </button>
      </div>

      <p className="cg-empty-note">
        Keys are stored on this machine only and never sent anywhere but the provider.
      </p>
    </section>
  );
}
