import type { CSSProperties } from "react";
import type { Metadata } from "next";
import SiteHeader from "@/components/site-header";
import SiteFooter from "@/components/site-footer";
import CopyButtons from "@/components/copy-buttons";
import Effects from "@/components/effects";
import { FOOTER_LINKS, GITHUB, HEADER_CTA, ISSUES, NAV } from "@/lib/site";

export const metadata: Metadata = {
  title: "Download ContextGit",
  description:
    "Get ContextGit on your machine: run it from source in five minutes, or install the CLI with pip. Signed installers for macOS, Windows and Linux are coming.",
};

const d = (ms: number) => ({ "--d": `${ms}ms` }) as CSSProperties;

const STEPS: Array<{ no: string; title: string; body: React.ReactNode; code?: string; copy?: string }> = [
  {
    no: "01",
    title: "Clone the repository",
    body: <>Everything is in one public repository — app, desktop, core and docs.</>,
    code: `git clone https://github.com/Prof-bilal/ContextGit.git\ncd ContextGit`,
    copy: "git clone https://github.com/Prof-bilal/ContextGit.git",
  },
  {
    no: "02",
    title: "Start the backend",
    body: <>Python 3.11+ and a virtual environment. This runs the core, the API and the CLI.</>,
    code: `python -m venv .venv\nsource .venv/bin/activate\npip install -e ".[dev]"\nuvicorn contextgit.api.main:app --reload --port 8756`,
    copy: 'pip install -e ".[dev]"',
  },
  {
    no: "03",
    title: "Start the desktop app",
    body: <>A second terminal. This opens the workbench with a local backend.</>,
    code: `cd desktop\nnpm install\nnpm run dev`,
    copy: "cd desktop && npm install && npm run dev",
  },
  {
    no: "04",
    title: "Open a project",
    body: (
      <>
        Point the app at a folder, or use the CLI. The first run creates{" "}
        <code className="mono">.contextgit/contextgit.db</code> and a root commit.
      </>
    ),
    code: `mkdir my-project && cd my-project\nctx init .\nctx commit -m "first turn"`,
    copy: "ctx init .",
  },
];

const REQUIREMENTS: Array<[string, string]> = [
  ["Python", "3.11 or newer — core, API and CLI."],
  ["Node.js", "20 or newer — desktop app and sidecars."],
  ["Git", "Worktrees are how runs stay isolated."],
  ["Disk", "The editor (code-server) and database client (DbGate) are fetched on first run."],
];

export default function DownloadPage() {
  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>

      <SiteHeader links={NAV} cta={HEADER_CTA} logoHref="/" />

      <span className="sr-only" id="copy-status" role="status" aria-live="polite"></span>

      <main id="main">
        <section className="section page-hero" data-section aria-labelledby="download-title">
          <div className="wrap">
            <header className="section-head reveal">
              <p className="eyebrow"><span className="chip">Download</span><span>Local-first. No account.</span></p>
              <h1 id="download-title" className="page-h1">Get ContextGit on your machine.</h1>
              <p className="lede">
                The product is the desktop workbench. Today it runs from source in about five
                minutes — the CLI alone takes one command.
              </p>
              <p className="hero-actions reveal" style={d(80)}>
                <a className="btn btn-primary" href={GITHUB}>Clone from GitHub <span aria-hidden="true">&rarr;</span></a>
                <a className="btn btn-ghost" href="#source">Run from source</a>
              </p>
              <p className="fineprint reveal" style={d(120)}>
                Signed installers for macOS, Windows and Linux are being prepared. Until they are
                published, source is the supported path — and nothing here needs an account.
              </p>
            </header>
          </div>
        </section>

        <section className="section section-tint" id="source" data-section aria-labelledby="source-title">
          <div className="wrap">
            <header className="section-head reveal">
              <p className="eyebrow"><span className="eyebrow-no">01</span>Run from source</p>
              <h2 id="source-title">Four commands to the first agent run.</h2>
              <p className="lede">Two terminals: one for the backend, one for the desktop app. Copy buttons are live.</p>
            </header>

            <ol className="dl-steps">
              {STEPS.map((s, i) => (
                <li key={s.no} className="dl-step reveal" style={d(i * 60)}>
                  <p className="dl-step-head">
                    <span className="dl-step-no mono">{s.no}</span>
                    <strong>{s.title}</strong>
                  </p>
                  <p className="dl-step-body">{s.body}</p>
                  {s.code ? (
                    <div className="install dl-install">
                      <pre className="term"><code>{s.code}</code></pre>
                      <button type="button" className="btn btn-ghost btn-copy" data-copy={s.copy} aria-label={`Copy command for ${s.title}`}>Copy</button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="section" id="cli" data-section aria-labelledby="cli-title">
          <div className="wrap">
            <header className="section-head reveal">
              <p className="eyebrow"><span className="eyebrow-no">02</span>CLI only</p>
              <h2 id="cli-title">Prefer the terminal? Start with the CLI.</h2>
              <p className="lede">
                The core library and the CLI are the same package the desktop app uses. It gives
                you init, commit, branch, checkout, log, diff and merge without opening the
                workbench.
              </p>
            </header>

            <div className="reveal" style={d(80)}>
              <div className="install">
                <code>pip install contextgit</code>
                <button type="button" className="btn btn-ghost btn-copy" data-copy="pip install contextgit" aria-label="Copy install command">Copy</button>
              </div>
              <p className="fineprint">Planned package name — not yet published to PyPI. Until then, install from the repository with <code className="mono">pip install -e .</code></p>
            </div>

            <div className="dl-req reveal" style={d(120)}>
              <h3 className="minor">System requirements</h3>
              <dl className="feat-list">
                {REQUIREMENTS.map(([term, desc]) => (
                  <div key={term}>
                    <dt>{term}</dt>
                    <dd>{desc}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </section>

        <section className="section section-tint" id="trouble" data-section aria-labelledby="trouble-title">
          <div className="wrap">
            <header className="section-head reveal">
              <p className="eyebrow"><span className="eyebrow-no">03</span>When it breaks</p>
              <h2 id="trouble-title">It&apos;s an early build. Tell us what broke.</h2>
              <p className="lede">
                Rough edges are expected — losing a bug report is not. Issues and discussions are
                open on GitHub, and the whole stack is readable while you debug it.
              </p>
            </header>

            <p className="hero-actions reveal" style={d(80)}>
              <a className="btn btn-primary" href={ISSUES}>Open an issue <span aria-hidden="true">&rarr;</span></a>
              <a className="btn btn-ghost" href={`${GITHUB}#readme`}>Read the README</a>
            </p>
          </div>
        </section>

        <section className="section section-end" data-section aria-labelledby="download-cta-title">
          <div className="wrap">
            <div className="cta reveal">
              <h2 id="download-cta-title" className="cta-title">Five minutes from clone to first run.</h2>
              <p className="cta-lede">One window for your agents, editor, browser, API and database clients — with context you can branch and merge.</p>
              <div className="cta-actions">
                <a className="btn btn-signal" href={GITHUB}>Clone from GitHub <span aria-hidden="true">&rarr;</span></a>
                <a className="btn btn-link-cta" href="/features">See features <span aria-hidden="true">&rarr;</span></a>
              </div>
              <p className="fineprint cta-fine">Early build. Everything stays on your machine except the model calls you make.</p>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter links={FOOTER_LINKS} />
      <CopyButtons />
      <Effects />
    </>
  );
}
