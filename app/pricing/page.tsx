import { Fragment, type CSSProperties } from "react";
import type { Metadata } from "next";
import SiteHeader from "@/components/site-header";
import SiteFooter from "@/components/site-footer";
import PricingTiers from "@/components/pricing-tiers";
import Effects from "@/components/effects";
import { COMPARE_ROWS, TIERS, WAITLIST_HREF } from "@/lib/pricing";

export const metadata: Metadata = {
  title: "Pricing — ContextGit",
  description:
    "ContextGit is free on your machine. Pro adds a security audit, cloud sync and cloud agents. Team adds collaboration. No prices yet — early access.",
};

const d = (ms: number) => ({ "--d": `${ms}ms` }) as CSSProperties;

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/#fleet", label: "Control tower" },
  { href: "/#workflow", label: "Workflow" },
  { href: "/#merge", label: "Merge engine" },
  { href: "/#interface", label: "Interface" },
  { href: "/#status", label: "Status" },
  { href: "/pricing", label: "Pricing" },
  { href: "/#install", label: "Install" },
];

const FOOTER_LINKS = [
  { href: "/#workflow", label: "Workflow" },
  { href: "/#merge", label: "Merge engine" },
  { href: "/#interface", label: "Interface" },
  { href: "/#status", label: "Status" },
  { href: "/pricing", label: "Pricing" },
  { href: "/#install", label: "Install" },
];

function Cell({ value }: { value: boolean | string }) {
  if (value === true) return <span className="cmp-yes" role="img" aria-label="Included">&#10003;</span>;
  if (value === false) return <span className="cmp-no" role="img" aria-label="Not included">&ndash;</span>;
  return <span>{value}</span>;
}

export default function PricingPage() {
  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>

      <SiteHeader links={NAV} cta={{ label: "Install", href: "/#install" }} logoHref="/" />

      <main id="main">
        <section className="section pricing-hero" data-section aria-labelledby="pricing-title">
          <div className="wrap">
            <header className="section-head reveal">
              <p className="eyebrow"><span className="eyebrow-no">Pricing</span>Free to run. Paid to scale.</p>
              <h2 id="pricing-title">Free on your machine. Paid for the cloud.</h2>
              <p className="lede">
                The whole local workbench is free, forever: the conversation DAG, parallel agent
                runs, team mode, the merge queue, every tab, and any model you bring. Paid tiers
                add the things a growing project needs — the security audit, cloud sync, offloaded
                runs and collaboration.
              </p>
              <p className="fineprint">Early access. Free is available now; Pro, Team and Enterprise are coming.</p>
            </header>

            <div className="reveal" style={d(80)}>
              <PricingTiers />
            </div>
          </div>
        </section>

        <section className="section section-tint" id="compare" data-section aria-labelledby="compare-title">
          <div className="wrap">
            <header className="section-head reveal">
              <p className="eyebrow">Compare</p>
              <h2 id="compare-title">Every plan, side by side.</h2>
              <p className="lede">The local app is the same in every tier. Paid plans add scale, cloud and collaboration on top.</p>
            </header>

            <div className="table-wrap reveal" style={d(80)}>
              <table className="compare">
                <caption className="sr-only">ContextGit plan comparison by feature</caption>
                <thead>
                  <tr>
                    <th scope="col">Feature</th>
                    {TIERS.map((tier) => (
                      <th key={tier.id} scope="col">{tier.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {COMPARE_ROWS.map((row) => (
                    <Fragment key={row.label}>
                      {row.group ? (
                        <tr className="cmp-group">
                          <th scope="colgroup" colSpan={TIERS.length + 1}>{row.group}</th>
                        </tr>
                      ) : null}
                      <tr>
                        <th scope="row">{row.label}</th>
                        {TIERS.map((tier) => (
                          <td key={tier.id}><Cell value={row.values[tier.id]} /></td>
                        ))}
                      </tr>
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="section" id="free" data-section aria-labelledby="free-title">
          <div className="wrap">
            <header className="section-head reveal">
              <p className="eyebrow">Free forever</p>
              <h2 id="free-title">Nothing about the local app is a trial.</h2>
              <p className="lede">
                We do not cripple the free tier to sell the paid one. Everything that runs on your
                machine is complete and unlimited — no account, no expiry, no per-token meter.
              </p>
            </header>

            <ul className="free-forever reveal" style={d(80)}>
              <li>
                <strong>Your history, your file</strong>
                <span>Commits live in one SQLite file on your machine. Nothing syncs unless you ask it to.</span>
              </li>
              <li>
                <strong>Bring your own model</strong>
                <span>Any provider and key works on Free. Managed inference is a convenience, not a gate.</span>
              </li>
              <li>
                <strong>No account to start</strong>
                <span>Install and go. Accounts only arrive with the cloud tiers.</span>
              </li>
              <li>
                <strong>Unlimited projects and runs</strong>
                <span>Free is not capped by project count, commit count or agent runs.</span>
              </li>
            </ul>
          </div>
        </section>

        <section className="section section-night" id="waitlist" data-section aria-labelledby="waitlist-title">
          <div className="wrap">
            <header className="section-head reveal">
              <p className="eyebrow">Coming soon</p>
              <h2 id="waitlist-title">Want Pro or Team when it lands?</h2>
              <p className="lede">
                Prices are not set yet. Tell us what you would need and we will let you know the
                moment the paid tiers are available.
              </p>
            </header>
            <div className="waitlist reveal" style={d(80)}>
              <a className="btn btn-link-cta" href={WAITLIST_HREF}>Notify me <span aria-hidden="true">&rarr;</span></a>
              <a className="btn btn-ghost-night" href={WAITLIST_HREF}>Talk to us about Enterprise</a>
            </div>
            <p className="fineprint cta-fine">Opens your mail client. A one-click signup is on the way.</p>
          </div>
        </section>

        <section className="section" id="pricing-faq" data-section aria-labelledby="faq-title">
          <div className="wrap">
            <header className="section-head reveal">
              <p className="eyebrow">Questions</p>
              <h2 id="faq-title">Pricing, answered.</h2>
            </header>

            <div className="faq reveal">
              <details>
                <summary>Is Free really free?</summary>
                <p>Yes. The complete local app is free, unlimited and needs no account. Only the cloud and collaboration tiers will be paid.</p>
              </details>
              <details>
                <summary>What is in Pro?</summary>
                <p>A security audit of your own project, encrypted cloud backup and sync, cloud agents that run the heavy work off your machine, and managed inference credits. Your own key keeps working on Free.</p>
              </details>
              <details>
                <summary>When do the paid tiers launch?</summary>
                <p>Not yet — the tiers are listed so you can see where this is going. Join the waitlist and we will tell you when they are ready.</p>
              </details>
              <details>
                <summary>Why are there no prices?</summary>
                <p>Because the product is early. We would rather show you the plans and the honest features than a number we cannot stand behind yet.</p>
              </details>
              <details>
                <summary>Do I need an account?</summary>
                <p>No. Free runs entirely on your machine. An account is only needed for the cloud tiers, when they ship.</p>
              </details>
              <details>
                <summary>Can I self-host?</summary>
                <p>Free is already local. A self-hosted sync server for teams is an Enterprise option on the roadmap.</p>
              </details>
              <details>
                <summary>Where does my data go?</summary>
                <p>Nowhere by default. Commits stay in a local SQLite file; the only network traffic is the model calls you make.</p>
              </details>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter links={FOOTER_LINKS} />
      <Effects />
    </>
  );
}
