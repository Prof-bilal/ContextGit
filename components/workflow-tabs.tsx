"use client";

/* Workflow verb tabs with roving tabindex and arrow/Home/End keys.
   Ported 1:1 from landing/script.js initTabs(). */

import { useEffect } from "react";

export default function WorkflowTabs() {
  useEffect(() => {
    const cleanups: Array<() => void> = [];
    document.querySelectorAll<HTMLElement>("[data-tabs]").forEach((root) => {
      const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
      const activate = (tab: HTMLButtonElement, focus: boolean) => {
        tabs.forEach((t) => {
          const on = t === tab;
          t.setAttribute("aria-selected", String(on));
          t.setAttribute("tabindex", on ? "0" : "-1");
          const panel = t.getAttribute("aria-controls");
          const panelEl = panel ? document.getElementById(panel) : null;
          if (panelEl) panelEl.hidden = !on;
        });
        if (focus) tab.focus();
      };
      tabs.forEach((tab, i) => {
        const onClick = () => activate(tab, false);
        const onKey = (e: KeyboardEvent) => {
          let next: HTMLButtonElement | null = null;
          if (e.key === "ArrowDown" || e.key === "ArrowRight") next = tabs[(i + 1) % tabs.length];
          else if (e.key === "ArrowUp" || e.key === "ArrowLeft") next = tabs[(i - 1 + tabs.length) % tabs.length];
          else if (e.key === "Home") next = tabs[0];
          else if (e.key === "End") next = tabs[tabs.length - 1];
          if (next) {
            e.preventDefault();
            activate(next, true);
          }
        };
        tab.addEventListener("click", onClick);
        tab.addEventListener("keydown", onKey);
        cleanups.push(() => {
          tab.removeEventListener("click", onClick);
          tab.removeEventListener("keydown", onKey);
        });
      });
    });
    return () => cleanups.forEach((fn) => fn());
  }, []);

  return null;
}
