(() => {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const el = (name, attrs = {}, parent) => {
    const node = document.createElementNS(SVG_NS, name);
    Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, String(v)));
    if (parent) parent.appendChild(node);
    return node;
  };

  const html = (tag, props = {}, children = []) => {
    const node = document.createElement(tag);
    Object.entries(props).forEach(([k, v]) => {
      if (k === 'text') node.textContent = v;
      else if (k === 'class') node.className = v;
      else node.setAttribute(k, v);
    });
    children.forEach((c) => node.appendChild(c));
    return node;
  };

  /* ---------- commit data (mirrors the example repo used across the page) ---------- */

  const LANES = { main: 44, redis: 104, memory: 164 };

  const COMMITS = [
    { id: 'a3f9c21', b: 'main', x: 60, kind: 'root', parents: [], title: 'Start the design chat', summary: 'System prompt and the first question: design a rate limiter for a public API.', tokens: '212', model: 'example-model' },
    { id: '7be04d8', b: 'main', x: 170, kind: 'normal', parents: ['a3f9c21'], title: 'Spec the limit', summary: 'Decided on 100 requests per minute per API key, with a short burst allowance.', tokens: '640', model: 'example-model' },
    { id: '1d6c9a0', b: 'main', x: 280, kind: 'normal', parents: ['7be04d8'], title: 'Compare storage options', summary: 'Listed where counters could live. Two candidates worth trying. This is the branch point.', tokens: '1,440', model: 'example-model' },
    { id: '5d2f8e1', b: 'main', x: 480, kind: 'normal', parents: ['1d6c9a0'], title: 'Add audit logging', summary: 'Decided to log every allow and deny decision for audit.', tokens: '1,916', model: 'example-model' },
    { id: 'f10c7a6', b: 'main', x: 700, kind: 'merge', parents: ['5d2f8e1', '4c07a1e'], title: 'Merge redis-bucket', summary: 'Token bucket in Redis, 50 ms skew tolerated, dead end recorded. One conflict resolved by hand.', tokens: '2,318', model: 'example-model' },
    { id: '9e41b7d', b: 'redis', x: 390, kind: 'normal', parents: ['1d6c9a0'], title: 'Redis token bucket', summary: 'Token bucket in Redis, one Lua call per request. Atomic per key.', tokens: '2,104', model: 'example-model' },
    { id: '4c07a1e', b: 'redis', x: 560, kind: 'normal', parents: ['9e41b7d'], title: 'Cross-region clock skew', summary: 'Refill reads Redis server time. Skew up to 50 ms is tolerated. Counters only, no per-request logging.', tokens: '4,632', model: 'example-model' },
    { id: 'b82e5c3', b: 'memory', x: 390, kind: 'normal', parents: ['1d6c9a0'], title: 'In-process counters', summary: 'Per-node counters with periodic sync. Fast, but limits drift across nodes.', tokens: '1,860', model: 'example-model' },
    { id: 'e3a9d04', b: 'memory', x: 500, kind: 'note', parents: ['b82e5c3'], title: 'Dead end: fails on failover', summary: 'Counters reset when a node restarts, so a failover grants a fresh burst. Abandoned.', tokens: '2,250', model: 'example-model' }
  ];

  const BRANCH_NAME = { main: 'main', redis: 'redis-bucket', memory: 'in-memory' };
  const BRANCH_LABEL = [
    { b: 'main', x: 115, y: 18, text: 'main' },
    { b: 'redis', x: 475, y: 128, text: 'redis-bucket' },
    { b: 'memory', x: 524, y: 168, text: 'in-memory', start: true }
  ];
  const byId = Object.fromEntries(COMMITS.map((c) => [c.id, c]));
  const pos = (c) => ({ x: c.x, y: LANES[c.b] });

  /* ---------- commit graph ---------- */

  const edgePath = (from, to) => {
    const a = pos(from);
    const b = pos(to);
    if (a.y === b.y) return `M${a.x} ${a.y} L${b.x} ${b.y}`;
    const mid = a.x + (b.x - a.x) / 2;
    return `M${a.x} ${a.y} C${mid} ${a.y} ${mid} ${b.y} ${b.x} ${b.y}`;
  };

  const renderEdges = (svg, widen) => {
    const layer = el('g', {}, svg);
    COMMITS.forEach((c) => {
      c.parents.forEach((pid, i) => {
        const parent = byId[pid];
        const branch = i === 0 ? c.b : parent.b;
        const edge = el('path', { class: 'g-edge', 'data-b': branch, d: edgePath(parent, c) }, layer);
        if (widen) edge.setAttribute('stroke-width', '5');
      });
    });
  };

  const renderHeroGraph = () => {
    const svg = document.getElementById('hero-graph');
    const inspector = document.getElementById('hero-inspector');
    if (!svg || !inspector) return;

    renderEdges(svg, false);

    BRANCH_LABEL.forEach((l) => {
      const t = el('text', { class: 'g-branch', 'data-b': l.b, x: l.x, y: l.y }, svg);
      if (l.start) t.style.textAnchor = 'start';
      t.textContent = l.text;
    });

    const nodes = COMMITS.map((c) => {
      const p = pos(c);
      const g = el('g', {
        class: 'g-node',
        'data-b': c.b,
        'data-kind': c.kind,
        'data-id': c.id,
        role: 'button',
        tabindex: '-1',
        'aria-pressed': 'false',
        'aria-label': `Commit ${c.id}, ${c.title}, branch ${BRANCH_NAME[c.b]}${c.kind === 'merge' ? ', merge commit' : ''}${c.kind === 'note' ? ', dead-end note' : ''}`
      }, svg);
      el('circle', { class: 'g-hit', cx: p.x, cy: p.y, r: 22, fill: 'transparent' }, g);
      el('circle', { class: 'g-focus', cx: p.x, cy: p.y, r: 19 }, g);
      el('circle', { class: 'g-sel', cx: p.x, cy: p.y, r: 16 }, g);
      el('circle', { class: 'g-dot', cx: p.x, cy: p.y, r: c.kind === 'merge' ? 11 : 9 }, g);
      const t = el('text', { class: 'g-id', x: p.x, y: p.y + 32 }, g);
      t.textContent = c.id;
      return g;
    });

    const renderInspector = (c) => {
      inspector.replaceChildren(
        html('div', { class: 'insp-top' }, [
          html('p', { class: 'insp-id', text: c.id }),
          html('span', { class: 'insp-kind', 'data-kind': c.kind, text: c.kind === 'note' ? 'dead-end note' : c.kind })
        ]),
        html('h3', { class: 'insp-title', text: c.title }),
        html('p', { class: 'insp-sum', text: c.summary }),
        html('dl', { class: 'insp-kv' }, [
          html('div', {}, [html('dt', { text: 'Branch' }), html('dd', { text: BRANCH_NAME[c.b] })]),
          html('div', {}, [html('dt', { text: c.parents.length > 1 ? 'Parents' : 'Parent' }), html('dd', { class: 'mono', text: c.parents.length ? c.parents.join(', ') : 'none (root)' })]),
          html('div', {}, [html('dt', { text: 'Context at this commit' }), html('dd', { text: `${c.tokens} tokens` })]),
          html('div', {}, [html('dt', { text: 'Model' }), html('dd', { text: c.model })])
        ])
      );
    };

    const select = (id, focus) => {
      nodes.forEach((n) => {
        const on = n.dataset.id === id;
        n.setAttribute('aria-pressed', String(on));
        n.setAttribute('tabindex', on ? '0' : '-1');
        if (on && focus) n.focus();
      });
      renderInspector(byId[id]);
    };

    const nearest = (fromId, dir) => {
      const a = pos(byId[fromId]);
      let best = null;
      let bestScore = Infinity;
      COMMITS.forEach((c) => {
        if (c.id === fromId) return;
        const p = pos(c);
        const dx = p.x - a.x;
        const dy = p.y - a.y;
        const ok = (dir === 'ArrowRight' && dx > 0) || (dir === 'ArrowLeft' && dx < 0) || (dir === 'ArrowDown' && dy > 0) || (dir === 'ArrowUp' && dy < 0);
        if (!ok) return;
        const horizontal = dir === 'ArrowRight' || dir === 'ArrowLeft';
        const score = horizontal ? Math.abs(dx) + Math.abs(dy) * 3 : Math.abs(dy) + Math.abs(dx) * 0.6;
        if (score < bestScore) { best = c.id; bestScore = score; }
      });
      return best;
    };

    let current = 'f10c7a6';
    let moved = false;

    svg.addEventListener('click', (e) => {
      const node = e.target.closest('.g-node');
      if (!node) return;
      current = node.dataset.id;
      select(current, false);
    });

    svg.addEventListener('keydown', (e) => {
      const node = e.target.closest('.g-node');
      if (!node) return;
      const id = node.dataset.id;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        current = id;
        select(id, false);
        return;
      }
      if (e.key.startsWith('Arrow')) {
        const next = nearest(id, e.key);
        if (next) {
          e.preventDefault();
          nodes.forEach((n) => n.setAttribute('tabindex', n.dataset.id === next ? '0' : '-1'));
          svg.querySelector(`[data-id="${next}"]`).focus();
        }
      }
    });

    svg.addEventListener('focusout', (e) => {
      if (svg.contains(e.relatedTarget)) return;
      nodes.forEach((n) => n.setAttribute('tabindex', n.dataset.id === current ? '0' : '-1'));
    });

    select(current, false);
    moved = true;
    return moved;
  };

  const renderMiniGraph = () => {
    const svg = document.getElementById('app-graph');
    if (!svg) return;
    renderEdges(svg, true);
    COMMITS.forEach((c) => {
      const p = pos(c);
      const g = el('g', { class: 'g-node', 'data-b': c.b, 'data-kind': c.kind }, svg);
      if (c.id === '4c07a1e') el('circle', { class: 'g-sel', cx: p.x, cy: p.y, r: 24, style: 'opacity:1;stroke-width:3' }, g);
      el('circle', { class: 'g-dot', cx: p.x, cy: p.y, r: c.kind === 'merge' ? 17 : 14, 'stroke-width': 5 }, g);
    });
    svg.setAttribute('aria-hidden', 'true');
  };

  /* ---------- copy buttons ---------- */

  const initCopy = () => {
    const status = document.getElementById('copy-status');
    document.querySelectorAll('[data-copy]').forEach((btn) => {
      const label = btn.textContent;
      btn.addEventListener('click', async () => {
        let ok = true;
        try {
          await navigator.clipboard.writeText(btn.dataset.copy);
        } catch (_) {
          const ta = document.createElement('textarea');
          ta.value = btn.dataset.copy;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          try { ok = document.execCommand('copy'); } catch (_e) { ok = false; }
          ta.remove();
        }
        btn.textContent = ok ? 'Copied' : 'Copy failed';
        if (status) status.textContent = ok ? 'Install command copied to clipboard.' : 'Copy failed. Select the command and copy it manually.';
        setTimeout(() => { btn.textContent = label; }, 1800);
      });
    });
  };

  /* ---------- tabs ---------- */

  const initTabs = () => {
    document.querySelectorAll('[data-tabs]').forEach((root) => {
      const tabs = Array.from(root.querySelectorAll('[role="tab"]'));
      const activate = (tab, focus) => {
        tabs.forEach((t) => {
          const on = t === tab;
          t.setAttribute('aria-selected', String(on));
          t.setAttribute('tabindex', on ? '0' : '-1');
          const panel = document.getElementById(t.getAttribute('aria-controls'));
          if (panel) panel.hidden = !on;
        });
        if (focus) tab.focus();
      };
      tabs.forEach((tab, i) => {
        tab.addEventListener('click', () => activate(tab, false));
        tab.addEventListener('keydown', (e) => {
          let next = null;
          if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length];
          else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = tabs[(i - 1 + tabs.length) % tabs.length];
          else if (e.key === 'Home') next = tabs[0];
          else if (e.key === 'End') next = tabs[tabs.length - 1];
          if (next) { e.preventDefault(); activate(next, true); }
        });
      });
    });
  };

  /* ---------- merge dialog ---------- */

  const initMerge = () => {
    const form = document.getElementById('merge-dialog');
    if (!form) return;
    const error = document.getElementById('merge-error');
    const apply = document.getElementById('merge-apply');
    const reset = document.getElementById('merge-reset');
    const done = document.getElementById('merge-done');
    const editField = document.getElementById('edit-field');
    const editArea = document.getElementById('edit-summary');
    const step = document.getElementById('step-apply');
    const radios = Array.from(form.querySelectorAll('input[name="resolution"]'));
    let resolutionNote = null;

    const showError = (msg, focusTarget) => {
      error.textContent = msg;
      error.hidden = false;
      if (focusTarget) focusTarget.focus();
    };
    const clearError = () => { error.hidden = true; error.textContent = ''; };
    const choice = () => (radios.find((r) => r.checked) || {}).value;

    radios.forEach((r) => r.addEventListener('change', () => {
      clearError();
      editField.hidden = choice() !== 'edit';
      if (choice() === 'edit') editArea.focus();
    }));
    editArea.addEventListener('input', clearError);

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const picked = choice();
      if (!picked) {
        showError('Choose how to resolve the logging conflict before applying. A merge never resolves a conflict for you.', radios[0]);
        return;
      }
      if (picked === 'edit' && !editArea.value.trim()) {
        showError('The summary line is empty. Write the line to store in the merge commit, or pick a side.', editArea);
        return;
      }
      clearError();
      apply.disabled = true;
      reset.disabled = true;
      apply.textContent = 'Writing merge commit';

      setTimeout(() => {
        const text = picked === 'target'
          ? 'Conflict resolved: kept the target. Every allow and deny decision is logged.'
          : picked === 'source'
            ? 'Conflict resolved: kept the source. Counters only, no per-request logging.'
            : `Conflict resolved by edit: ${editArea.value.trim()}`;
        if (resolutionNote) resolutionNote.remove();
        resolutionNote = html('p', { class: 'done-note', text });
        done.insertBefore(resolutionNote, done.querySelector('.done-grid'));
        form.dataset.state = 'done';
        done.hidden = false;
        step.dataset.done = 'true';
        apply.disabled = false;
        reset.disabled = false;
        apply.textContent = 'Apply merge';
        done.focus();
      }, reduceMotion ? 0 : 650);
    });

    reset.addEventListener('click', () => {
      radios.forEach((r) => { r.checked = false; });
      editField.hidden = true;
      clearError();
    });

    const doneReset = html('button', { type: 'button', class: 'btn btn-ghost-night', text: 'Reset preview' });
    done.appendChild(doneReset);
    doneReset.addEventListener('click', () => {
      radios.forEach((r) => { r.checked = false; });
      editField.hidden = true;
      form.dataset.state = 'idle';
      done.hidden = true;
      step.dataset.done = 'false';
      if (resolutionNote) { resolutionNote.remove(); resolutionNote = null; }
      radios[0].focus();
    });
  };

  /* ---------- SHA-256 ---------- */

  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);

  const sha256 = (bytes) => {
    const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const bitLen = bytes.length * 8;
    const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
    padded.set(bytes);
    padded[bytes.length] = 0x80;
    const view = new DataView(padded.buffer);
    view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
    view.setUint32(padded.length - 4, bitLen >>> 0);
    const w = new Uint32Array(64);
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let off = 0; off < padded.length; off += 64) {
      for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(off + i * 4);
      for (let i = 16; i < 64; i += 1) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, hh] = h;
      for (let i = 0; i < 64; i += 1) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) >>> 0;
        hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
    }
    return Array.from(h, (x) => x.toString(16).padStart(8, '0')).join('');
  };

  const escapeJson = (s) => JSON.stringify(s);

  const canonicalCommit = (content) =>
    '{"messages":[{"content":' + escapeJson(content) + ',"role":"user"}],'
    + '"metadata":{"kind":"normal","model":"example-model"},'
    + '"parent_ids":["a3f9c21"]}';

  const initHash = () => {
    const input = document.getElementById('hash-msg');
    if (!input) return;
    const canon = document.getElementById('hash-canon');
    const out = document.getElementById('hash-out');
    const status = document.getElementById('hash-status');
    const resetBtn = document.getElementById('hash-reset');
    const original = input.value;
    const encoder = new TextEncoder();
    const baseHash = sha256(encoder.encode(canonicalCommit(original)));
    const shortEl = out.querySelector('.hash-short');
    const restEl = out.querySelector('.hash-rest');

    const update = () => {
      const text = canonicalCommit(input.value);
      const hash = sha256(encoder.encode(text));
      canon.textContent = text;
      shortEl.textContent = hash.slice(0, 7);
      restEl.textContent = hash.slice(7);
      let diff = 0;
      for (let i = 0; i < 64; i += 1) if (hash[i] !== baseHash[i]) diff += 1;
      if (diff === 0) {
        status.textContent = 'Same bytes, same commit id.';
        status.dataset.changed = 'false';
      } else {
        status.textContent = `New commit id. ${diff} of 64 characters differ from the original.`;
        status.dataset.changed = 'true';
      }
      resetBtn.disabled = diff === 0 && input.value === original;
    };

    input.addEventListener('input', update);
    resetBtn.addEventListener('click', () => { input.value = original; update(); input.focus(); });
    update();
  };

  /* ---------- reveal, scroll spy, typed text ---------- */

  const initReveal = () => {
    const items = document.querySelectorAll('.reveal');
    if (reduceMotion || !('IntersectionObserver' in window)) {
      items.forEach((i) => i.classList.add('in'));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    items.forEach((i) => io.observe(i));
  };

  const initSpy = () => {
    const rail = document.querySelector('.rail');
    const links = Array.from(document.querySelectorAll('.rail a'));
    const sections = Array.from(document.querySelectorAll('[data-section]'));
    if (!rail || !('IntersectionObserver' in window)) return;
    const set = (id) => {
      links.forEach((a) => {
        if (a.getAttribute('href') === `#${id}`) a.setAttribute('aria-current', 'true');
        else a.removeAttribute('aria-current');
      });
      rail.dataset.tone = id === 'merge' ? 'night' : 'paper';
    };
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) set(e.target.id); });
    }, { rootMargin: '-45% 0px -50% 0px', threshold: 0 });
    sections.forEach((s) => io.observe(s));
    set('top');
  };

  const initMenu = () => {
    const menu = document.querySelector('.menu');
    if (!menu) return;
    menu.addEventListener('click', (e) => { if (e.target.closest('a')) menu.removeAttribute('open'); });
    menu.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && menu.open) { menu.removeAttribute('open'); menu.querySelector('summary').focus(); }
    });
    document.addEventListener('click', (e) => { if (menu.open && !menu.contains(e.target)) menu.removeAttribute('open'); });
  };

  const initTyped = () => {
    const target = document.getElementById('typed');
    if (!target || reduceMotion || !('IntersectionObserver' in window)) return;
    const full = target.textContent;
    const seen = html('span');
    const rest = html('span', { class: 'rest', text: full });
    target.textContent = '';
    target.append(seen, rest);
    let ran = false;
    const io = new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting || ran) return;
      ran = true;
      io.disconnect();
      let n = 0;
      const timer = setInterval(() => {
        n = Math.min(full.length, n + 3);
        seen.textContent = full.slice(0, n);
        rest.textContent = full.slice(n);
        if (n >= full.length) clearInterval(timer);
      }, 22);
    }, { threshold: 0.5 });
    io.observe(target);
  };

  const boot = () => {
    renderHeroGraph();
    renderMiniGraph();
    initCopy();
    initTabs();
    initMerge();
    initHash();
    initReveal();
    initSpy();
    initMenu();
    initTyped();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
