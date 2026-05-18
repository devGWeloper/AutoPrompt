'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { GraphNode } from '@/types';

const TYPE_COLORS: Record<string, string> = {
  LLM: 'bg-blue-500',
  TOOL: 'bg-emerald-500',
  ROUTER: 'bg-amber-500',
  START: 'bg-slate-500',
  END: 'bg-slate-800',
};

export default function NodeCard({ data }: NodeProps) {
  const node = data as unknown as GraphNode;
  const color = TYPE_COLORS[node.node_type ?? ''] || 'bg-slate-400';
  return (
    <div className="min-w-[200px] rounded-lg border border-slate-300 bg-white shadow-sm">
      <Handle type="target" position={Position.Top} />
      <div className={`flex items-center justify-between rounded-t-lg px-3 py-1.5 text-white ${color}`}>
        <span className="text-xs font-semibold uppercase">{node.node_type || 'NODE'}</span>
        <span className="text-[10px] opacity-80">#{node.node_id}</span>
      </div>
      <div className="px-3 py-2">
        <div className="text-sm font-medium">{node.node_nm}</div>
        <div className="mt-1 text-xs text-slate-500">key: {node.node_key}</div>
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {node.active_prompt ? (
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono">
              v{node.active_prompt.version_no}
            </span>
          ) : (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">no prompt</span>
          )}
          {node.active_model && (
            <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-700" title={`${node.active_model.model_provider} / ${node.active_model.model_nm}`}>
              {node.active_model.model_nm}
            </span>
          )}
          <span className="ml-auto text-[10px] text-slate-400" title="Phase 1: latest test status not yet wired">!</span>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
