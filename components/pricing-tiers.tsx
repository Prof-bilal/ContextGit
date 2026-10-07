import { TIERS, type Tier } from "@/lib/pricing";

const FLAG: Record<Tier["status"], string> = {
  live: "Available now",
  soon: "Coming soon",
  contact: "Contact sales",
};

export default function PricingTiers({
  compact = false,
  limit = 5,
}: {
  compact?: boolean;
  limit?: number;
}) {
  return (
    <ul className={`plans${compact ? " plans-compact" : ""}`}>
      {TIERS.map((tier) => {
        const features = compact ? tier.features.slice(0, limit) : tier.features;
        return (
          <li
            key={tier.id}
            className={`plan${tier.featured ? " is-featured" : ""}`}
            data-status={tier.status}
          >
            <div className="plan-head">
              <h3 className="plan-name">{tier.name}</h3>
              <span className="plan-flag">{FLAG[tier.status]}</span>
            </div>
            <p className="plan-desc">{tier.tagline}</p>
            <p className="plan-price">{tier.price}</p>
            <p className="plan-price-note">{tier.priceNote}</p>
            <ul className="plan-features">
              {features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
            {compact && tier.features.length > features.length ? (
              <p className="plan-more mono">+{tier.features.length - features.length} more</p>
            ) : null}
            <a
              className={`btn plan-cta ${tier.featured ? "btn-primary" : "btn-ghost"}`}
              href={tier.ctaHref}
            >
              {tier.ctaLabel}
            </a>
          </li>
        );
      })}
    </ul>
  );
}
