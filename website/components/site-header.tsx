import ThemeToggle from "@/components/theme-toggle";

export interface NavLink {
  href: string;
  label: string;
}

export default function SiteHeader({
  links,
  cta,
  logoHref = "/",
}: {
  links: NavLink[];
  cta: { label: string; href: string };
  logoHref?: string;
}) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <a className="logo" href={logoHref} aria-label="ContextGit, home">
          <svg className="logo-mark" viewBox="0 0 32 32" width={28} height={28} aria-hidden="true" focusable="false">
            <rect width={32} height={32} rx={7} fill="currentColor" />
            <path d="M9 8v16M9 12c0 6 14 2 14 8" fill="none" stroke="var(--paper)" strokeWidth={2.4} strokeLinecap="round" />
            <circle cx={9} cy={8} r={2.6} fill="var(--paper)" />
            <circle cx={9} cy={24} r={2.6} fill="var(--paper)" />
            <circle cx={23} cy={20} r={3} fill="var(--signal)" />
          </svg>
          <span className="logo-word">Context<span className="logo-git">Git</span></span>
        </a>
        <details className="menu">
          <summary>Sections</summary>
          <ol className="menu-list">
            {links.map((link) => (
              <li key={link.href}>
                <a href={link.href}>{link.label}</a>
              </li>
            ))}
          </ol>
        </details>
        <ThemeToggle />
        <a className="btn btn-primary btn-sm" href={cta.href}>{cta.label}</a>
      </div>
    </header>
  );
}
