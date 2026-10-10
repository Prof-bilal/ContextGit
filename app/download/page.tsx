import type { CSSProperties } from "react";
import type { Metadata } from "next";
import SiteHeader from "@/components/site-header";
import SiteFooter from "@/components/site-footer";
import CopyButtons from "@/components/copy-buttons";
import Effects from "@/components/effects";
import { FOOTER_LINKS, GITHUB, HEADER_CTA, ISSUES, NAV } from "@/lib/site";

const RELEASE_URL = `${GITHUB}/releases/tag/v0.1.0-beta.4`;
const RELEASE_ASSET_BASE = `${GITHUB}/releases/download/v0.1.0-beta.4`;

export const metadata: Metadata = {
  title: "Download ContextGit",
  description:
    "Install the ContextGit beta for Windows, macOS, or Linux and start a local terminal-agent workbench.",
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

const INSTALLERS: Array<[string, string, string]> = [
  ["Windows", "x64 · unsigned NSIS installer", `${RELEASE_ASSET_BASE}/contextgit-windows-x64-ContextGit-Setup-0.1.0-beta.4.exe`],
  ["macOS Intel", "x64 · unsigned DMG", `${RELEASE_ASSET_BASE}/contextgit-macos-x64-ContextGit-0.1.0-beta.4.dmg`],
  ["macOS Apple Silicon", "arm64 · unsigned DMG", `${RELEASE_ASSET_BASE}/contextgit-macos-arm64-ContextGit-0.1.0-beta.4-arm64.dmg`],
  ["Linux x86_64 AppImage", "AMD/Intel 64-bit · any distro · recommended", `${RELEASE_ASSET_BASE}/contextgit-linux-x64-ContextGit-0.1.0-beta.4.AppImage`],
  ["Linux x86_64 .pacman", "Arch/Omarchy/Manjaro · AMD/Intel 64-bit", `${RELEASE_ASSET_BASE}/contextgit-linux-x64-contextgit-desktop-0.1.0-beta.4.pacman`],
  ["Linux x86_64 .deb", "Debian/Ubuntu · AMD/Intel 64-bit", `${RELEASE_ASSET_BASE}/contextgit-linux-x64-contextgit-desktop_0.1.0-beta.4_amd64.deb`],
  ["Linux x86_64 .rpm", "Fedora/RHEL/SUSE · AMD/Intel 64-bit", `${RELEASE_ASSET_BASE}/contextgit-linux-x64-contextgit-desktop-0.1.0-beta.4.x86_64.rpm`],
  ["Linux x86_64 tar.gz", "Any distro · AMD/Intel 64-bit", `${RELEASE_ASSET_BASE}/contextgit-linux-x64-contextgit-desktop-0.1.0-beta.4.tar.gz`],
  ["Linux ARM64 AppImage", "aarch64 · any distro", `${RELEASE_ASSET_BASE}/contextgit-linux-arm64-ContextGit-0.1.0-beta.4-arm64.AppImage`],
  ["Linux ARM64 .pacman", "Arch/Omarchy/Manjaro · aarch64", `${RELEASE_ASSET_BASE}/contextgit-linux-arm64-contextgit-desktop-0.1.0-beta.4-aarch64.pacman`],
  ["Linux ARM64 .deb", "Debian/Ubuntu · aarch64", `${RELEASE_ASSET_BASE}/contextgit-linux-arm64-contextgit-desktop_0.1.0-beta.4_arm64.deb`],
  ["Linux ARM64 .rpm", "Fedora/RHEL/SUSE · aarch64", `${RELEASE_ASSET_BASE}/contextgit-linux-arm64-contextgit-desktop-0.1.0-beta.4.aarch64.rpm`],
  ["Linux ARM64 tar.gz", "Any distro · aarch64", `${RELEASE_ASSET_BASE}/contextgit-linux-arm64-contextgit-desktop-0.1.0-beta.4-arm64.tar.gz`],
];

const REQUIREMENTS: Array<[string, string]> = [
  ["Git", "Required for isolated worktrees and diffs."],
  ["Terminal agent", "Install the agent you want to launch, such as OpenCode, Claude Code, Codex, or Gemini CLI."],
  ["Editor", "Use the editor you already have installed; the beta does not bundle one."],
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
              <p className="eyebrow"><span className="chip">Beta</span><span>Install like a normal desktop app</span></p>
              <h1 id="download-title" className="page-h1">Download. Install. Start an agent.</h1>
              <p className="lede">
                You do not need to clone the repository, create a Python environment, or start a
                backend manually. Download the installer for your operating system and ContextGit
                starts its local backend for you.
              </p>
              <p className="hero-actions reveal" style={d(80)}>
                <a className="btn btn-primary" href={RELEASE_URL}>Open beta downloads <span aria-hidden="true">&rarr;</span></a>
                <a className="btn btn-ghost" href="#install">How installation works</a>
              </p>
              <p className="fineprint reveal" style={d(120)}>
                Unsigned installers are published through GitHub Releases. Verify the matching
                SHA-256 checksum before opening the app.
              </p>
            </header>
          </div>
        </section>

        <section className="section section-tint" id="install" data-section aria-labelledby="install-title">
          <div className="wrap">
            <header className="section-head reveal">
              <p className="eyebrow"><span className="eyebrow-no">01</span>Install flow</p>
              <h2 id="install-title">A regular desktop app, with a local backend included.</h2>
              <p className="lede">The installer contains the desktop shell and backend. You choose a project and agent after launch.</p>
            </header>

            <ol className="dl-steps">
              {[
                ["01", "Download the installer", "Choose your exact operating system and CPU architecture. On AMD/Intel Linux, choose x86_64; on ARM Linux, choose ARM64/aarch64."],
                ["02", "Install and open ContextGit", "Windows may show SmartScreen and macOS may show Gatekeeper because the beta is unsigned."],
                ["03", "Choose a project", "Select an existing Git repository or create a project folder from the app."],
                ["04", "Start your agent", "Choose an installed terminal agent, open Code, and begin working. ContextGit manages the local backend automatically."],
              ].map(([no, title, body], i) => (
                <li key={no} className="dl-step reveal" style={d(i * 60)}>
                  <p className="dl-step-head"><span className="dl-step-no mono">{no}</span><strong>{title}</strong></p>
                  <p className="dl-step-body">{body}</p>
                </li>
              ))}
            </ol>

            <div className="reveal" style={d(260)}>
              <ul className="pillars">
                {INSTALLERS.map(([platform, detail, href]) => <li key={platform}><h3 className="pillar-title"><a href={href}>{platform}</a></h3><p>{detail}</p><a className="fineprint" href={href}>Download installer <span aria-hidden="true">&rarr;</span></a></li>)}
              </ul>
              <p className="fineprint" style={{ marginTop: "var(--s6)" }}>
                Linux guide: Omarchy/Arch uses <code className="mono">.pacman</code>; Debian/Ubuntu uses <code className="mono">.deb</code>; Fedora/RHEL uses <code className="mono">.rpm</code>. AppImage and tar.gz work across distributions. x86_64 is the correct build for both AMD and Intel 64-bit PCs.
              </p>
              <p className="hero-actions" style={{ marginTop: "var(--s8)" }}><a className="btn btn-primary" href={RELEASE_URL}>Choose your installer <span aria-hidden="true">&rarr;</span></a></p>
            </div>
          </div>
        </section>

        <section className="section" id="developer" data-section aria-labelledby="cli-title">
          <div className="wrap">
            <header className="section-head reveal">
              <p className="eyebrow"><span className="eyebrow-no">02</span>For developers</p>
              <h2 id="cli-title">Want to run from source instead?</h2>
              <p className="lede">
                Source installation is available for contributors and developers. It is not required
                for normal desktop use.
              </p>
            </header>

            <ol className="dl-steps">
              {STEPS.map((s, i) => (
                <li key={s.no} className="dl-step reveal" style={d(i * 60)}>
                  <p className="dl-step-head"><span className="dl-step-no mono">{s.no}</span><strong>{s.title}</strong></p>
                  <p className="dl-step-body">{s.body}</p>
                  {s.code ? <div className="install dl-install"><pre className="term"><code>{s.code}</code></pre><button type="button" className="btn btn-ghost btn-copy" data-copy={s.copy} aria-label={`Copy command for ${s.title}`}>Copy</button></div> : null}
                </li>
              ))}
            </ol>

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
              <h2 id="download-cta-title" className="cta-title">Install once. Start locally.</h2>
              <p className="cta-lede">Download the beta, open a project, and launch the terminal agent you already use.</p>
              <div className="cta-actions">
                <a className="btn btn-signal" href={RELEASE_URL}>Open beta downloads <span aria-hidden="true">&rarr;</span></a>
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
