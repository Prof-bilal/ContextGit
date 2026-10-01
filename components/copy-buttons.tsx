"use client";

/* Clipboard copy buttons and the polite live region. Ported 1:1 from
   landing/script.js with a textarea fallback. */

import { useEffect } from "react";

export default function CopyButtons() {
  useEffect(() => {
    const status = document.getElementById("copy-status");
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-copy]"));
    const cleanups: Array<() => void> = [];

    buttons.forEach((btn) => {
      const label = btn.textContent;
      const onClick = async () => {
        let ok = true;
        try {
          await navigator.clipboard.writeText(btn.dataset.copy ?? "");
        } catch {
          const ta = document.createElement("textarea");
          ta.value = btn.dataset.copy ?? "";
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          try {
            ok = document.execCommand("copy");
          } catch {
            ok = false;
          }
        ta.remove();
        }
        btn.textContent = ok ? "Copied" : "Copy failed";
        if (status) {
          status.textContent = ok
            ? "Install command copied to clipboard."
            : "Copy failed. Select the command and copy it manually.";
        }
        setTimeout(() => {
          btn.textContent = label;
        }, 1800);
      };
      btn.addEventListener("click", onClick);
      cleanups.push(() => btn.removeEventListener("click", onClick));
    });

    return () => cleanups.forEach((fn) => fn());
  }, []);

  return null;
}
