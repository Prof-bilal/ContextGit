"use client";

/* Interactive hero commit graph with keyboard navigation and inspector.
   Ported 1:1 from landing/script.js renderHeroGraph(). */

import { useEffect, useRef } from "react";
import { SVG_NS, COMMITS, BRANCH_NAME, BRANCH_LABEL, byId, pos, edgePath } from "@/lib/landing";

export default function HeroGraph() {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = svgRef.current;
    const inspector = document.getElementById("hero-inspector");
    if (!svg || !inspector) return;

    const el = (name: string, attrs: Record<string, unknown> = {}, parent?: Element) => {
      const node = document.createElementNS(SVG_NS, name);
      Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, String(v)));
      if (parent) parent.appendChild(node);
      return node;
    };
    const html = (tag: string, props: Record<string, string> = {}, children: Element[] = []) => {
      const node = document.createElement(tag);
      Object.entries(props).forEach(([k, v]) => {
        if (k === "text") node.textContent = v;
        else if (k === "class") node.className = v;
        else node.setAttribute(k, v);
      });
      children.forEach((c) => node.appendChild(c));
      return node;
    };

    /* edges */
    const layer = el("g", {}, svg);
    COMMITS.forEach((c) => {
      c.parents.forEach((pid, i) => {
        const parent = byId[pid];
        const branch = i === 0 ? c.b : parent.b;
        el("path", { class: "g-edge", "data-b": branch, d: edgePath(parent, c) }, layer);
      });
    });

    /* branch labels */
    BRANCH_LABEL.forEach((l) => {
      const t = el("text", { class: "g-branch", "data-b": l.b, x: l.x, y: l.y }, svg);
      if (l.start) t.style.textAnchor = "start";
      t.textContent = l.text;
    });

    /* nodes */
    const nodes = COMMITS.map((c) => {
      const p = pos(c);
      const g = el(
        "g",
        {
          class: "g-node",
          "data-b": c.b,
          "data-kind": c.kind,
          "data-id": c.id,
          role: "button",
          tabindex: "-1",
          "aria-pressed": "false",
          "aria-label": `Commit ${c.id}, ${c.title}, branch ${BRANCH_NAME[c.b]}${c.kind === "merge" ? ", merge commit" : ""}${c.kind === "note" ? ", dead-end note" : ""}`,
        },
        svg
      );
      el("circle", { class: "g-hit", cx: p.x, cy: p.y, r: 22, fill: "transparent" }, g);
      el("circle", { class: "g-focus", cx: p.x, cy: p.y, r: 19 }, g);
      el("circle", { class: "g-sel", cx: p.x, cy: p.y, r: 16 }, g);
      el("circle", { class: "g-dot", cx: p.x, cy: p.y, r: c.kind === "merge" ? 11 : 9 }, g);
      const t = el("text", { class: "g-id", x: p.x, y: p.y + 32 }, g);
      t.textContent = c.id;
      return g;
    });

    const renderInspector = (c: (typeof COMMITS)[number]) => {
      inspector.replaceChildren(
        html("div", { class: "insp-top" }, [
          html("p", { class: "insp-id", text: c.id }),
          html("span", { class: "insp-kind", "data-kind": c.kind, text: c.kind === "note" ? "dead-end note" : c.kind }),
        ]),
        html("h3", { class: "insp-title", text: c.title }),
        html("p", { class: "insp-sum", text: c.summary }),
        html("dl", { class: "insp-kv" }, [
          html("div", {}, [html("dt", { text: "Branch" }), html("dd", { text: BRANCH_NAME[c.b] })]),
          html("div", {}, [html("dt", { text: c.parents.length > 1 ? "Parents" : "Parent" }), html("dd", { class: "mono", text: c.parents.length ? c.parents.join(", ") : "none (root)" })]),
          html("div", {}, [html("dt", { text: "Context at this commit" }), html("dd", { text: `${c.tokens} tokens` })]),
          html("div", {}, [html("dt", { text: "Model" }), html("dd", { text: c.model })]),
        ])
      );
    };

    const select = (id: string, focus: boolean) => {
      nodes.forEach((n) => {
        const on = n.getAttribute("data-id") === id;
        n.setAttribute("aria-pressed", String(on));
        n.setAttribute("tabindex", on ? "0" : "-1");
        if (on && focus) n.focus();
      });
      renderInspector(byId[id]);
    };

    const nearest = (fromId: string, dir: string) => {
      const a = pos(byId[fromId]);
      let best: string | null = null;
      let bestScore = Infinity;
      COMMITS.forEach((c) => {
        if (c.id === fromId) return;
        const p = pos(c);
        const dx = p.x - a.x;
        const dy = p.y - a.y;
        const ok = (dir === "ArrowRight" && dx > 0) || (dir === "ArrowLeft" && dx < 0) || (dir === "ArrowDown" && dy > 0) || (dir === "ArrowUp" && dy < 0);
        if (!ok) return;
        const horizontal = dir === "ArrowRight" || dir === "ArrowLeft";
        const score = horizontal ? Math.abs(dx) + Math.abs(dy) * 3 : Math.abs(dy) + Math.abs(dx) * 0.6;
        if (score < bestScore) {
          best = c.id;
          bestScore = score;
        }
      });
      return best;
    };

    let current = "f10c7a6";

    const onSvgClick = (e: Event) => {
      const node = (e.target as Element).closest(".g-node");
      if (!node) return;
      current = node.getAttribute("data-id") ?? current;
      select(current, false);
    };
    const onSvgKeydown = (e: KeyboardEvent) => {
      const node = (e.target as Element).closest(".g-node");
      if (!node) return;
      const id = node.getAttribute("data-id") ?? "";
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        current = id;
        select(id, false);
        return;
      }
      if (e.key.startsWith("Arrow")) {
        const next = nearest(id, e.key);
        if (next) {
          e.preventDefault();
          nodes.forEach((n) => n.setAttribute("tabindex", n.getAttribute("data-id") === next ? "0" : "-1"));
          (svg.querySelector(`[data-id="${next}"]`) as HTMLElement | null)?.focus();
        }
      }
    };
    const onFocusout = (e: FocusEvent) => {
      if (e.relatedTarget && svg.contains(e.relatedTarget as Node)) return;
      nodes.forEach((n) => n.setAttribute("tabindex", n.getAttribute("data-id") === current ? "0" : "-1"));
    };

    svg.addEventListener("click", onSvgClick);
    svg.addEventListener("keydown", onSvgKeydown);
    svg.addEventListener("focusout", onFocusout);

    select(current, false);

    return () => {
      svg.removeEventListener("click", onSvgClick);
      svg.removeEventListener("keydown", onSvgKeydown);
      svg.removeEventListener("focusout", onFocusout);
      svg.replaceChildren();
      inspector.replaceChildren();
    };
  }, []);

  return (
    <svg
      ref={svgRef}
      id="hero-graph"
      className="graph"
      viewBox="0 0 800 208"
      role="group"
      aria-label="Commit graph, 9 commits on 3 branches. Use arrow keys to move between commits."
    />
  );
}
