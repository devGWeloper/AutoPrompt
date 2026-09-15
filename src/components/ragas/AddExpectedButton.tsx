'use client';

import { useState } from 'react';
import CaseImportModal from './CaseImportModal';
import { rowFromResult } from './caseFields';

/**
 * 정답 없이 돌린 결과를 그대로 기대 정답으로 굳힌다. 누르면 데이터셋 추가 창이
 * 이 질문과 결과 값을 채운 채 열리고, 데이터셋·폴더를 고르거나 값을 고친 뒤
 * 저장한다. 저장하고 나면 같은 자리에서 '추가됨'으로 남아, 두 번 넣었는지
 * 헷갈리지 않는다.
 */
export default function AddExpectedButton({
  question, contexts, answer, traceValue,
}: {
  question: string | null | undefined;
  contexts?: string | string[] | null;
  answer: string | null | undefined;
  traceValue?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [savedTo, setSavedTo] = useState<string | null>(null);
  const row = rowFromResult({ question, contexts, answer, trace_value: traceValue });
  if (!row.question || !row.groundTruth) return null;

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        title={savedTo ? `'${savedTo}' 에 추가했습니다 · 한 번 더 추가` : '이 값을 기대 정답으로 데이터셋에 추가'}
        className="inline-flex h-6 shrink-0 items-center gap-1 rounded-sm border border-line bg-surface px-2 text-[11px] font-medium text-body transition-colors hover:bg-surface-3 hover:text-ink"
      >
        {savedTo ? (
          <>
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden className="text-ok">
              <path d="M3 8.5l3.5 3.5L13 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            추가됨
          </>
        ) : (
          '정답으로 추가'
        )}
      </button>
      {open && (
        <CaseImportModal
          title="정답으로 데이터셋에 추가"
          initialRows={[row]}
          onClose={() => setOpen(false)}
          onSaved={(_, t) => setSavedTo(t.name)}
        />
      )}
    </>
  );
}
