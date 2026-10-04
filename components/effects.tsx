"use client";

/* Reveal-on-scroll, section scroll-spy, dropdown menu behavior and the typed
   chat message. Ported 1:1 from landing/script.js and run after mount so the
   server-rendered HTML matches the original static markup. */

import { useEffect } from "react";

export default function Effects() {
  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const cleanups: Array<() => void> = [];

    /* ---------- reveal ---------- */

    const items = Array.from(document.querySelectorAll<HTMLElement>(".reveal"));
    if (reduceMotion || !("IntersectionObserver" in window)) {
      items.forEach((i) => i.classList.add("in"));
    } else {
      const io = new IntersectionObserver(
        (entries) => {
          entries.forEach((e) => {
            if (e.isIntersecting) {
              e.target.classList.add("in");
              io.unobserve(e.target);
            }
          });
        },
        { threshold: 0.12, rootMargin: "0px 0px -6% 0px" }
      );
      items.forEach((i) => io.observe(i));
      cleanups.push(() => io.disconnect());
    }

    /* ---------- topbar shrink ---------- */

    const topbar = document.querySelector<HTMLElement>(".topbar");
    if (topbar) {
      const onScroll = () => {
        topbar.classList.toggle("is-scrolled", window.scrollY > 10);
      };
      onScroll();
      window.addEventListener("scroll", onScroll, { passive: true });
      cleanups.push(() => window.removeEventListener("scroll", onScroll));
    }

    /* ---------- scroll spy ---------- */

    const rail = document.querySelector<HTMLElement>(".rail");
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>(".rail a"));
    const sections = Array.from(document.querySelectorAll<HTMLElement>("[data-section]"));
    if (rail && "IntersectionObserver" in window) {
      const set = (id: string) => {
        links.forEach((a) => {
          if (a.getAttribute("href") === `#${id}`) a.setAttribute("aria-current", "true");
          else a.removeAttribute("aria-current");
        });
        rail.dataset.tone = id === "merge" ? "night" : "paper";
      };
      const io = new IntersectionObserver(
        (entries) => {
          entries.forEach((e) => {
            if (e.isIntersecting) set((e.target as HTMLElement).id);
          });
        },
        { rootMargin: "-45% 0px -50% 0px", threshold: 0 }
      );
      sections.forEach((s) => io.observe(s));
      set("top");
      cleanups.push(() => io.disconnect());
    }

    /* ---------- menu ---------- */

    const menu = document.querySelector<HTMLDetailsElement>(".menu");
    if (menu) {
      const onClick = (e: Event) => {
        if ((e.target as HTMLElement).closest("a")) menu.removeAttribute("open");
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape" && menu.open) {
          menu.removeAttribute("open");
          menu.querySelector("summary")?.focus();
        }
      };
      const onDocClick = (e: MouseEvent) => {
        if (menu.open && !menu.contains(e.target as Node)) menu.removeAttribute("open");
      };
      menu.addEventListener("click", onClick);
      menu.addEventListener("keydown", onKey);
      document.addEventListener("click", onDocClick);
      cleanups.push(() => {
        menu.removeEventListener("click", onClick);
        menu.removeEventListener("keydown", onKey);
        document.removeEventListener("click", onDocClick);
      });
    }

    /* ---------- typed text ---------- */

    const target = document.getElementById("typed");
    let timer: number | undefined;
    if (target && !reduceMotion && "IntersectionObserver" in window) {
      const full = target.textContent ?? "";
      const seen = document.createElement("span");
      const rest = document.createElement("span");
      rest.className = "rest";
      rest.textContent = full;
      target.textContent = "";
      target.append(seen, rest);
      let ran = false;
      const io = new IntersectionObserver(
        (entries) => {
          if (!entries[0].isIntersecting || ran) return;
          ran = true;
          io.disconnect();
          let n = 0;
          timer = window.setInterval(() => {
            n = Math.min(full.length, n + 3);
            seen.textContent = full.slice(0, n);
            rest.textContent = full.slice(n);
            if (n >= full.length) clearInterval(timer);
          }, 22);
        },
        { threshold: 0.5 }
      );
      io.observe(target);
      cleanups.push(() => {
        io.disconnect();
        if (timer !== undefined) clearInterval(timer);
      });
    }

    return () => cleanups.forEach((fn) => fn());
  }, []);

  return null;
}
