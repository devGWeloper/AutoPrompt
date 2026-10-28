'use client';

import type { Dataset, DatasetCategory } from '@/lib/types';
import { folderLabel } from './shared';

// 실행 조건 카드(Single · Compare)가 같이 쓰는 조각.

export type DataSource = 'dataset' | 'manual';

/** 실행 단추에 붙는 ▶ — '여기가 시작' 을 글자보다 먼저 말한다. */
export function PlayIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M4 2.8v10.4L13 8z" />
    </svg>
  );
}

/** 고른 데이터의 이름과 건수 — 실행 버튼이 "N건 실행" 으로 건수를 적는다. */
export function dataSummary(
  source: DataSource,
  datasets: Dataset[],
  datasetId: number | null,
  folders: DatasetCategory[],
  caseType: string | null,
  pickedCount: number | null = null,
): { label: string; badge?: string; count: number | null; empty: boolean } {
  const ds = datasets.find((d) => d.dataset_id === datasetId);
  const folder = caseType != null ? folders.find((c) => c.type_cd === caseType) : null;
  // 몇 건이 도는지 — 고른 케이스가 있으면 그 수, 폴더를 좁혔으면 폴더의 수,
  // 아니면 데이터셋 전체. 실행 버튼에 그대로 적는 값이다.
  const count = pickedCount ?? (folder ? folder.case_count : ds?.case_count ?? null);
  if (source === 'manual') return { label: '직접 입력', count, empty: false };
  if (!ds) return { label: '데이터셋 선택', count, empty: true };
  return {
    label: [ds.dataset_nm, folder ? folderLabel(folder.type_cd) : null].filter(Boolean).join(' · '),
    badge: pickedCount != null ? `선택 ${pickedCount}건` : count != null ? `${count}건` : undefined,
    count,
    empty: false,
  };
}
