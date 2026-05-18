'use client';

import dynamic from 'next/dynamic';

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false });

export default function PromptEditor({
  label,
  value,
  onChange,
  readOnly,
}: {
  label: string;
  value: string;
  onChange?: (v: string) => void;
  readOnly?: boolean;
}) {
  return (
    <div className="rounded border border-slate-200">
      <div className="border-b bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600">
        {label}
      </div>
      <MonacoEditor
        height="220px"
        defaultLanguage="markdown"
        value={value}
        onChange={(v) => onChange?.(v ?? '')}
        options={{
          readOnly,
          fontSize: 13,
          minimap: { enabled: false },
          wordWrap: 'on',
          scrollBeyondLastLine: false,
        }}
      />
    </div>
  );
}
