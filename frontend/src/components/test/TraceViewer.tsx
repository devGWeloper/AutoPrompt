'use client';

export interface TraceStep {
  node_id: number;
  node_key: string;
  status: 'running' | 'done' | 'skipped' | 'failed';
  output?: string;
  error?: string;
  latency_ms?: number;
  tokens?: number;
}

const DOT: Record<TraceStep['status'], string> = {
  running: 'bg-amber-500',
  done: 'bg-emerald-500',
  skipped: 'bg-slate-300',
  failed: 'bg-red-500',
};

export default function TraceViewer({ steps }: { steps: TraceStep[] }) {
  if (steps.length === 0) {
    return <div className="text-sm text-slate-500">No trace yet. Run the flow.</div>;
  }
  return (
    <ol className="space-y-2">
      {steps.map((s, i) => (
        <li
          key={`${s.node_id}-${i}`}
          className="rounded border border-slate-200 bg-white p-3 text-sm"
        >
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${DOT[s.status]}`} />
            <span className="font-mono text-xs">{s.node_key}</span>
            <span className="text-[10px] uppercase text-slate-400">{s.status}</span>
            <span className="ml-auto text-xs text-slate-400">
              {s.latency_ms != null && `${s.latency_ms} ms`}
              {s.tokens != null && ` · ${s.tokens} tok`}
            </span>
          </div>
          {s.error && (
            <pre className="mt-2 overflow-auto rounded bg-red-50 p-2 text-[11px] text-red-700">
              {s.error}
            </pre>
          )}
          {s.output != null && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-slate-500">output</summary>
              <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-50 p-2 text-[12px]">
                {s.output}
              </pre>
            </details>
          )}
        </li>
      ))}
    </ol>
  );
}
