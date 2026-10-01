"use client";

/* Small decorative graph inside the Interface section. Ported 1:1 from
   landing/script.js renderMiniGraph(). */

import { useEffect, useRef } from "react";
import { SVG_NS, COMMITS, pos, edgePath } from "@/lib/landing";

export default function MiniGraph() {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const el = (name: string, attrs: Record<string, unknown> = {}, parent?: Element) => {
      const node = document.createElementNS(SVG_NS, name);
      Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, String(v)));
      if (parent) parent.appendChild(node);
      return node;
    };

    const layer = el("g", {}, svg);
    COMMITS.forEach((c) => {
      c.parents.forEach((pid, i) => {
        const parent = (Object.fromEntries(COMMITS.map((x) => [x.id, x])) as Record<string, (typeof COMMITS)[number]>)[pid];
        const branch = i === 0 ? c.b : parent.b;
        const edge = el("path", { class: "g-edge", "data-b": branch, d: edgePath(parent, c) }, layer);
        edge.setAttribute("stroke-width", "5");
      });
    });

    COMMITS.forEach((c) => {
      const p = pos(c);
      const g = el("g", { class: "g-node", "data-b": c.b, "data-kind": c.kind }, svg);
      if (c.id === "4c07a1e") {
        el("circle", { class: "g-sel", cx: p.x, cy: p.y, r: 24, style: "opacity:1;stroke-width:3" }, g);
      }
      el("circle", { class: "g-dot", cx: p.x, cy: p.y, r: c.kind === "merge" ? 17 : 14, "stroke-width": 5 }, g);
    });

    svg.setAttribute("aria-hidden", "true");

    return () => {
      svg.replaceChildren();
    };
  }, []);

  return <svg ref={svgRef} id="app-graph" className="graph graph-mini" viewBox="0 0 800 208" />;
}
