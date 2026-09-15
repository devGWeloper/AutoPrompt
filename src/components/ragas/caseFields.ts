import { UNFILED } from './shared';

// A case's payload is the JSON in INPUT_CTN. The editor exposes the three fields
// the evaluation actually reads (see services/ragas.ts parseCase) and carries any
// other keys through untouched, so editing a case here never drops data that was
// imported from CSV or written by hand.
export interface Parsed {
  question: string;
  contexts: string[];
  groundTruth: string | null;
  rest: Record<string, unknown>;
}

export function parseCaseInput(raw: string): Parsed {
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('not an object');
    const { question, contexts, ground_truth: gt, ...rest } = o;
    const ctx = Array.isArray(contexts) ? contexts.map(String) : contexts ? [String(contexts)] : [];
    return {
      question: question == null ? '' : String(question),
      contexts: ctx,
      groundTruth: gt == null ? null : String(gt),
      rest,
    };
  } catch {
    // Not JSON — treat the whole string as the question so it stays editable.
    return { question: raw, contexts: [], groundTruth: null, rest: {} };
  }
}

/** Editable form state for one case. Also one row of the import grid. */
export interface Fields {
  question: string;
  contexts: string; // one per line
  groundTruth: string;
  category: string; // TYPE_CD; '' in the form means UNFILED
}

export const EMPTY: Fields = { question: '', contexts: '', groundTruth: '', category: '' };

export function toFields(p: Parsed, expected: string | null, caseType: string): Fields {
  return {
    question: p.question,
    contexts: p.contexts.join('\n'),
    // parseCase prefers input_data.ground_truth and falls back to EXPECT_CTN.
    groundTruth: p.groundTruth ?? expected ?? '',
    category: caseType === UNFILED ? '' : caseType,
  };
}

export function toPayload(f: Fields, rest: Record<string, unknown> = {}) {
  const contexts = f.contexts.split('\n').map((s) => s.trim()).filter(Boolean);
  const gt = f.groundTruth.trim();
  const input: Record<string, unknown> = { ...rest, question: f.question.trim() };
  if (contexts.length) input.contexts = contexts;
  else delete input.contexts;
  if (gt) input.ground_truth = gt;
  else delete input.ground_truth;
  // Both columns are written: EXPECT_CTN is what an unparseable input_data falls
  // back to, and it is the column the CSV round-trip carries.
  return {
    input_data: JSON.stringify(input),
    expected_output: gt || null,
    case_type: f.category.trim() || UNFILED,
  };
}
