'use client';

import { useMemo } from 'react';
import { Select } from '@/components/ui/Field';
import { useLlmModels } from '@/components/ragas/shared';
import { cn } from '@/lib/cn';

/**
 * 모델은 설정(`/settings` → 모델)에 등록된 이름 중에서만 고른다. 프롬프트 노드도
 * 예외가 아니다 — 자유 입력이던 시절에는 오타 하나로 존재하지 않는 모델이 버전에
 * 박제됐고, 실행 시점까지 아무도 그걸 몰랐다.
 *
 * 저장돼 있던 값이 목록에서 빠졌더라도 조용히 사라지지 않는다. 그 값만 따로
 * 옵션으로 남기고 테두리를 warn 으로 세워 눈에 걸리게 둔다.
 */
export function ModelSelect({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  className?: string;
}) {
  const all = useLlmModels();
  const catalog = useMemo(() => all.filter((m) => m.is_active === 'Y'), [all]);
  const missing = value !== '' && !catalog.some((m) => m.llm_nm === value);

  return (
    <Select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      title={missing ? `${value} — 설정에 등록되지 않은 모델` : value || '지정 안 함'}
      className={cn('font-mono text-sm', missing && 'border-warn', className)}
    >
      <option value="">—</option>
      {missing && <option value={value}>{value}</option>}
      {catalog.map((m) => (
        <option key={m.llm_id} value={m.llm_nm}>
          {m.llm_nm}
        </option>
      ))}
    </Select>
  );
}

export default ModelSelect;
