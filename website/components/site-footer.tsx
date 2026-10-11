import type { NavLink } from "@/components/site-header";

export default function SiteFooter({ links }: { links: NavLink[] }) {
  return (
    <footer className="footer">
      <div className="wrap footer-inner">
        <div>
          <p className="footer-brand">ContextGit</p>
          <p className="footer-tag">Run agents. Keep the work.</p>
        </div>
        <ul className="footer-links">
          {links.map((link) => (
            <li key={link.href}>
              <a href={link.href}>{link.label}</a>
            </li>
          ))}
        </ul>
        <p className="footer-fine">Local-first. Your history stays in a SQLite file on your machine.</p>
      </div>
    </footer>
  );
}
