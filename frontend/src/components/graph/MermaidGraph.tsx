'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

let _seq = 0;

type Box = { x: number; y: number; w: number; h: number };

export default function MermaidGraph({
  code,
  clickableNodes = [],
  onNodeClick,
}: {
  code: string;
  clickableNodes?: string[];
  onNodeClick?: (nodeNm: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // The <g> wrapping all diagram content; pan/zoom is an SVG-space transform on
  // it (not a CSS transform on the <svg>), so scaling re-renders the vector
  // crisply instead of upscaling a rasterised bitmap.
  const groupRef = useRef<SVGGElement | null>(null);
  // Base (fit) viewBox, used to map screen px <-> SVG user coords.
  const baseVB = useRef<Box | null>(null);
  // Current view transform in SVG user units: displayed = k * point + (tx, ty).
  const view = useRef({ k: 1, tx: 0, ty: 0 });
  const [error, setError] = useState<string | null>(null);

  const applyTransform = useCallback(() => {
    const g = groupRef.current;
    if (g)
      g.setAttribute(
        'transform',
        `translate(${view.current.tx} ${view.current.ty}) scale(${view.current.k})`,
      );
  }, []);

  // Meet-fit scale + letterbox offsets mapping baseVB onto the container rect
  // (svg is width/height 100% with preserveAspectRatio="xMidYMid meet").
  const fit = useCallback(() => {
    const el = ref.current;
    const vb = baseVB.current;
    if (!el || !vb) return null;
    const rect = el.getBoundingClientRect();
    const s = Math.min(rect.width / vb.w, rect.height / vb.h);
    return { s, offX: (rect.width - vb.w * s) / 2, offY: (rect.height - vb.h * s) / 2, rect };
  }, []);

  // Zoom by `factor` about a focal point (cx,cy) in container pixels, keeping
  // that point fixed on screen. Defaults to the container centre.
  const zoomBy = useCallback(
    (factor: number, cx?: number, cy?: number) => {
      const f = fit();
      const vb = baseVB.current;
      if (!f || !vb) return;
      const px = cx ?? f.rect.width / 2;
      const py = cy ?? f.rect.height / 2;
      const next = Math.min(8, Math.max(0.3, view.current.k * factor));
      const r = next / view.current.k;
      // Displayed-user coord under the cursor (before this zoom).
      const dx = vb.x + (px - f.offX) / f.s;
      const dy = vb.y + (py - f.offY) / f.s;
      view.current = {
        k: next,
        tx: dx * (1 - r) + r * view.current.tx,
        ty: dy * (1 - r) + r * view.current.ty,
      };
      applyTransform();
    },
    [fit, applyTransform],
  );

  const reset = useCallback(() => {
    view.current = { k: 1, tx: 0, ty: 0 };
    applyTransform();
  }, [applyTransform]);

  // ---- render the diagram --------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    // Expose a global callback that mermaid's `click ... call __pmNodeClick()`
    // directives invoke with the node id (== NODE_NM in our graphs).
    (window as unknown as { __pmNodeClick?: (id: string) => void }).__pmNodeClick = (id: string) =>
      onNodeClick?.(id);

    (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({ startOnLoad: false, securityLevel: 'loose', theme: 'default' });

        // Prompt-bearing nodes (== clickableNodes) get a soft blue fill matching
        // the sidebar node cards (blue-50 fill / blue-600 border), so the graph
        // and the node list read as the same "has prompt" marker.
        const directives = clickableNodes.length
          ? [
              'classDef pmHasPrompt fill:#eff6ff,stroke:#2563eb,stroke-width:2px;',
              `class ${clickableNodes.join(',')} pmHasPrompt;`,
              ...clickableNodes.map((nm) => `click ${nm} call __pmNodeClick()`),
            ].join('\n')
          : '';
        const source = directives ? `${code}\n${directives}\n` : code;

        const id = `pm-mermaid-${_seq++}`;
        const { svg, bindFunctions } = await mermaid.render(id, source);
        if (cancelled || !ref.current) return;
        ref.current.innerHTML = svg;
        bindFunctions?.(ref.current);

        const svgEl = ref.current.querySelector('svg');
        if (svgEl) {
          // Fit the SVG to the container (whole flow incl. `start` visible).
          svgEl.removeAttribute('width');
          svgEl.removeAttribute('height');
          svgEl.style.width = '100%';
          svgEl.style.height = '100%';
          svgEl.style.maxWidth = '100%';
          svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');

          // Record the base viewBox for px<->user mapping.
          const parts = (svgEl.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
          baseVB.current =
            parts.length === 4 && parts.every(Number.isFinite)
              ? { x: parts[0], y: parts[1], w: parts[2], h: parts[3] }
              : null;

          // Wrap all diagram content in a <g> we transform for pan/zoom. Moving
          // the existing nodes keeps mermaid's bound click handlers intact.
          const SVG_NS = 'http://www.w3.org/2000/svg';
          const g = document.createElementNS(SVG_NS, 'g');
          g.setAttribute('class', 'pm-zoom');
          while (svgEl.firstChild) g.appendChild(svgEl.firstChild);
          svgEl.appendChild(g);
          groupRef.current = g;
        }
        // only prompt-bearing nodes are clickable — show the pointer cursor on
        // those alone (mermaid tags interactive nodes with the `clickable` class).
        ref.current.querySelectorAll<SVGGElement>('g.node.clickable').forEach((g) => {
          (g as unknown as HTMLElement).style.cursor = 'pointer';
        });
        // reset view for the freshly rendered graph
        view.current = { k: 1, tx: 0, ty: 0 };
        applyTransform();
        setError(null);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code, clickableNodes, onNodeClick, applyTransform]);

  // ---- wheel zoom + drag pan ----------------------------------------------
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - rect.left, e.clientY - rect.top);
    };

    let dragging = false;
    let sx = 0;
    let sy = 0;
    let ox = 0;
    let oy = 0;
    const onPointerDown = (e: PointerEvent) => {
      // Don't start a pan on a clickable node, so its click still fires.
      if ((e.target as Element).closest?.('g.node.clickable')) return;
      dragging = true;
      sx = e.clientX;
      sy = e.clientY;
      ox = view.current.tx;
      oy = view.current.ty;
      el.setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return;
      const f = fit();
      if (!f) return;
      // Convert screen px delta to SVG user units.
      view.current.tx = ox + (e.clientX - sx) / f.s;
      view.current.ty = oy + (e.clientY - sy) / f.s;
      applyTransform();
    };
    const onPointerUp = (e: PointerEvent) => {
      dragging = false;
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* pointer may not be captured */
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointerleave', onPointerUp);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointerleave', onPointerUp);
    };
  }, [zoomBy, fit, applyTransform]);

  if (error) {
    return (
      <div className="rounded-md border-2 border-red-200 bg-red-50 p-4">
        <div className="mb-2 text-sm font-bold text-red-700">그래프 렌더링 실패</div>
        <pre className="overflow-auto whitespace-pre-wrap text-xs text-red-600">{error}</pre>
        <pre className="mt-2 overflow-auto whitespace-pre-wrap rounded bg-white p-2 text-xs text-slate-600">
          {code}
        </pre>
      </div>
    );
  }

  const btn =
    'flex h-8 w-8 items-center justify-center rounded-md border-2 border-slate-300 bg-white text-lg font-bold leading-none text-slate-600 shadow-sm hover:bg-slate-100';

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div
        ref={ref}
        className="h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
      />
      <div className="absolute right-3 top-3 flex flex-col gap-1">
        <button type="button" onClick={() => zoomBy(1.2)} className={btn} title="확대">
          +
        </button>
        <button type="button" onClick={() => zoomBy(1 / 1.2)} className={btn} title="축소">
          −
        </button>
        <button type="button" onClick={reset} className={btn + ' text-xs'} title="원래 크기로">
          ⤢
        </button>
      </div>
    </div>
  );
}
