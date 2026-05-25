'use client';

import { useEffect, useRef, useState } from 'react';

let _seq = 0;

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
  const [error, setError] = useState<string | null>(null);

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

        const directives = clickableNodes
          .map((nm) => `click ${nm} call __pmNodeClick()`)
          .join('\n');
        const source = directives ? `${code}\n${directives}\n` : code;

        const id = `pm-mermaid-${_seq++}`;
        const { svg, bindFunctions } = await mermaid.render(id, source);
        if (cancelled || !ref.current) return;
        ref.current.innerHTML = svg;
        bindFunctions?.(ref.current);
        // make clickable nodes look interactive
        clickableNodes.forEach(() => {});
        ref.current.querySelectorAll<SVGGElement>('g.node').forEach((g) => {
          (g as unknown as HTMLElement).style.cursor = 'pointer';
        });
        setError(null);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code, clickableNodes, onNodeClick]);

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

  return <div ref={ref} className="flex w-full justify-center [&_svg]:max-w-full" />;
}
