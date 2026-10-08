import { useEffect, useState } from "react";

export type ShellTheme = "dark" | "light";

function readTheme(): ShellTheme {
  const shell = document.querySelector(".cg-shell");
  return shell?.getAttribute("data-cg-theme") === "light" ? "light" : "dark";
}

/** Follows the `.cg-shell` theme attribute so embedded editors stay in sync. */
export function useShellTheme(): ShellTheme {
  const [theme, setTheme] = useState<ShellTheme>(readTheme);

  useEffect(() => {
    const shell = document.querySelector(".cg-shell");
    if (!shell) return;
    const observer = new MutationObserver(() => setTheme(readTheme()));
    observer.observe(shell, {
      attributes: true,
      attributeFilter: ["data-cg-theme"],
    });
    return () => observer.disconnect();
  }, []);

  return theme;
}
