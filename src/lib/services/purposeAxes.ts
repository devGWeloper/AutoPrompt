// 목적 축 분석 — 폴더 하나를 표로 세워, 케이스마다 "이 건으로 무엇을 확인하는가" 를
// LLM 없이 짓는다.
//
// 지금의 `fillCasePurposes` 는 같은 폴더의 형제들을 한꺼번에 LLM 에 올려 놓고
// "서로 무엇이 다른지 드러나게 쓰라" 고 시킨다. 그런데 정답지가 JSON 이면 그
// '서로 다른 지점' 은 부탁할 일이 아니라 세면 나오는 값이다. 같은 폴더 안에서는
// 키가 같고 값만 다르기 때문이다.
//
// 그래서 정답지를 leaf path 로 펴서 path = 열, 케이스 = 행인 표를 만들고, 열마다
// 서로 다른 값이 몇 가지인지로 그 열의 역할을 가른다.
//
//   전건 한 값      → 고정값. 폴더의 전제지 이 건의 특징이 아니다. 목적에서 뺀다.
//   두어 갈래       → 분류축. 사람이 일부러 갈라 둔 지점이다. 목적의 본문.
//   전건 제각각     → 자유값. 주문번호·타임스탬프·금액이다. 원값은 버린다.
//
// 마지막 줄이 이 파일의 알맹이다. LLM 이 "A-1031 주문의 취소를 확인" 같은 쓸모없는
// 목적을 가끔 뱉는 이유가 주문번호를 변별점으로 오해해서인데, 열로 세워 놓고 보면
// 전건이 다른 열은 아무것도 가르지 못한다는 게 그냥 보인다.
//
// 자유값이라고 버리기만 하면 아까워서, 값에서 갈래가 적은 특성을 뽑아 가상의 열로
// 다시 세운다 — 배열은 길이, 숫자는 부호, 무엇이든 빈 값 여부와 타입. 금액이 전건
// 다르더라도 '0이냐 아니냐' 는 두 갈래라 축이 된다.
//
// 한 건의 목적은 그 건이 가진 분류축 값들 가운데 '같은 값을 나눠 갖는 형제가 가장
// 적은' 것부터 두 개다. 스무 건 중 나만 CANCELLED 인 쪽이 절반이 같은 값인 쪽보다
// 이 건을 더 잘 말해 준다.
//
// path 표기는 `exactMatch` 의 것을 그대로 쓴다. 목적에 적힌 `refund.fee` 와 키별
// 판정 표의 `refund.fee` 가 같은 글자여야, 실패한 키에서 그 키를 확인하려던 목적으로
// 되짚을 수 있다.
//
// 순수 함수만 둔다 — DB 도 LLM 도 타지 않으므로 표 하나를 넣고 결과를 눈으로 볼 수
// 있고, 화면이 버튼을 누르기 전에 축을 미리 보여 줄 수도 있다.

import { jsonShape, jsonValueOf, type JsonLeaf } from "@/lib/exactMatch";

/** 분석에 필요한 것은 케이스 번호와 정답지뿐이다. TestCase 를 받지 않는 건 이 파일을
 * DB 스키마에서 떼어 놓기 위해서다. */
export interface PurposeCase {
  case_id: number;
  /** 정답지 원문 — INPUT_CTN 의 `ground_truth` 또는 EXPECT_CTN. */
  ground_truth: string | null;
  /** 입력 글. 없어도 되지만, 있으면 '입력을 되비추는 열' 을 가려낼 수 있다 —
   * 아래 ECHO_SHARE 설명 참고. */
  question?: string | null;
}

/** 열이 무엇을 재고 있는가. `value` 만 정답지에 실제로 적힌 값이고 나머지는 거기서
 * 뽑아낸 특성이다. */
export type AxisKind = "value" | "present" | "length" | "blank" | "sign" | "type";

/** 열이 폴더 안에서 하는 일. */
export type AxisRole =
  /** 전건 같은 값 — 폴더의 전제. */
  | "fixed"
  /** 갈래가 몇 개로 갈림 — 목적에 쓸 수 있는 축. */
  | "split"
  /** 너무 잘게 갈려 한 줄로 말할 수 없음 — 식별자·금액·날짜. */
  | "free";

export interface AxisCell {
  /** 사람이 읽는 값. */
  text: string;
  /** 같은 값인지 가르는 열쇠. `value` 열에서만 text 와 달라진다. */
  key: string;
}

export interface AxisColumn {
  /** `${kind}:${path}` — 화면이 축을 고를 때와 React key 로 쓴다. */
  id: string;
  /** 키별 판정 표와 한 글자도 다르지 않은 path. 맨 위는 빈 문자열이다. */
  path: string;
  kind: AxisKind;
  /** 미리보기 표의 열 이름 — `refund.amt 부호` 처럼 무엇을 재는지까지. */
  label: string;
  role: AxisRole;
  /** case_id → 이 건의 값. 그 건에 값이 없으면 키가 없다. */
  cells: Map<number, AxisCell>;
  /** 서로 다른 값의 가짓수. */
  distinct: number;
  /** 값을 가진 건 수. */
  present: number;
  /** 입력 글을 되비추는 열인가. 값이 질문 안에 그대로 들어 있다는 뜻이라, 전건이
   * 달라도 식별자가 아니라 '이 건이 무엇에 관한 것인가' 다. 이런 열은 갈래 수와
   * 상관없이 목적에 쓴다 — `role` 은 여전히 `free` 로 남는다. */
  echo: boolean;
  /** 값을 따옴표째 적어야 하는 열인가. 표시용 값은 같은데 열쇠가 갈릴 때 — 즉
   * `200` 과 `"200"` 이 섞여 있을 때만 참이다. 키별 판정 표가 타입이 어긋난 줄에만
   * 따옴표를 씌우는 것과 같은 이유다. */
  quoted: boolean;
}

/** 형제들과 키 집합이 다른 건. "카테고리 안에서 키는 같다" 는 전제를 깨는 쪽이라
 * 대개 정답지의 오타이거나 스키마가 어긋난 자리다 — 목적을 채우다 공짜로 걸린다. */
export interface SchemaOutlier {
  case_id: number;
  /** 형제 대다수에 있는데 이 건에만 없는 path. */
  missing: string[];
  /** 이 건에만 있는 path. */
  extra: string[];
}

export interface FolderAxes {
  folder: string;
  /** 넣은 건 수. */
  cases: number;
  /** 정답지가 JSON 으로 읽힌 건 수 — 모든 비율의 분모다. */
  parsed: number;
  /** 정답지가 JSON 이 아니어서 축을 볼 수 없던 건. LLM 으로 넘길 몫이다. */
  unparsed: number[];
  /** 만들어진 모든 열. 미리보기 표가 그리는 것. */
  columns: AxisColumn[];
  /** 목적에 실제로 쓰인 축, 변별력 순. */
  splits: AxisColumn[];
  /** 폴더의 전제 — 전건 같은 값인 원값 열. */
  fixed: AxisColumn[];
  outliers: SchemaOutlier[];
  /** case_id → 목적 한 줄. 축이 잡히지 않은 건은 아예 키가 없다. */
  purposes: Map<number, string>;
}

export interface AxisOpts {
  folder?: string;
  /** path → 한글 이름. 없으면 path 를 그대로 쓴다. 이 사전만 있으면 목적이 한국어로
   * 읽히므로, LLM 이 필요하다면 여기 한 번이면 된다 — 건별이 아니라 폴더당 한 번. */
  labels?: Record<string, string>;
  /** 목적 한 줄에 넣을 축 수. 기본 2. */
  lineAxes?: number;
  /** 목적 한 줄의 길이 상한. 기본 60 — 목록에서 한 줄로 읽히는 길이. */
  maxLen?: number;
  /** 사람이 화면에서 고른 축의 id. 주면 자동 선택 대신 이것만, 준 순서대로 쓴다.
   * 고른 것이면 `free` 로 갈린 열도 쓴다 — 분류가 사람의 판단을 이기면 안 된다. */
  pick?: string[];
  /** 정답지의 맨 위 `body` 를 벗길지. 최종 답변은 그래야 하고 트레이스 변수는 그러면
   * 안 된다 — `structuredMatch` 와 같은 규칙이다. */
  unwrapBody?: boolean;
}

/** 축 하나가 이보다 많이 갈리면 목적 한 줄로 읽히지 않는다. */
const SPLIT_MAX = 8;
/** 갈래로 치려면 겹치는 건이 전체의 몇 분의 일은 되어야 하는가. */
const REPEAT_SHARE = 3;
/** 자동으로 고르는 축은 폴더의 이만큼은 덮어야 한다. 반도 못 덮는 열은 폴더를
 * 가르는 축이 아니라 일부에만 있는 값이다 — 그 '일부' 가 뜻이 있다면 같은 path 의
 * 유무 축이 전건을 덮으며 이미 말하고 있다. */
const COVERAGE_MIN = 0.5;
/** 목적 한 줄에 박아 넣는 값의 길이 상한. */
const VALUE_MAX = 24;
const DEFAULT_LINE_AXES = 2;
const DEFAULT_MAX_LEN = 60;
/**
 * 입력을 되비추는 열로 치려면 값이 질문 안에서 발견되는 비율이 이만큼은 되어야 한다.
 *
 * 주문번호와 도시 이름은 둘 다 전건이 다르지만 같은 것이 아니다. "서울 날씨" 라고
 * 물어 `{"city":"서울"}` 이 돌아왔다면 그 값은 입력이 정한 주제고, 목적에 적어야
 * 읽힌다. 반면 `{"ord":"A-1027"}` 은 질문 어디에도 없다 — 시스템이 붙인 번호다.
 * 값이 질문에 그대로 있는지만 보면 둘이 갈린다.
 */
const ECHO_SHARE = 0.8;
/** 되비침으로 칠 값의 길이 범위. 한 글자는 아무 글에나 걸리고, 긴 값은 정답 문장이
 * 질문을 통째로 옮겨 적은 것이라 목적 한 줄에 넣을 것이 못 된다. */
const ECHO_MIN_LEN = 2;
const ECHO_MAX_LEN = 20;
/** 두 번째 축부터 넘어야 하는 변별력 문턱. 형제의 3/4 이상이 같은 값이면 그 축은
 * 이 건에 대해 할 말이 없는 것이다. */
const MIN_EXTRA_RARITY = 0.25;
/** 폴더 한 줄 설명에 늘어놓는 항목 수. */
const DESC_ITEMS = 3;

/** 미리보기 표의 열 이름에 붙는 꼬리 — 무엇을 재는 열인지. 원값은 꼬리가 없다. */
const KIND_LABEL: Record<AxisKind, string> = {
  value: "",
  present: "유무",
  length: "길이",
  blank: "값 유무",
  sign: "부호",
  type: "타입",
};

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

/** 배열 인덱스를 지나는 path 인가. `walk` 과 같은 표기를 쓰므로 인덱스가 박혀 있다는
 * 것이 곧 배열을 지났다는 뜻이다. (키 이름 자체가 인덱스 모양인 경우는 키별 판정
 * 표에서도 이미 구분되지 않는다 — 표기의 한계를 같이 쓴다.) */
function insideArray(path: string): boolean {
  return /\[\d+\]/.test(path);
}

/** 배열 인덱스를 지운 path. 길이가 다른 배열 때문에 온 폴더가 서로 스키마가 다르다고
 * 나오면 안 되므로, 키 집합을 견줄 때는 자리 번호를 지우고 본다. */
function collapseIdx(path: string): string {
  return path.replace(/\[\d+\]/g, "[]");
}

function nameOf(path: string, labels?: Record<string, string>): string {
  const given = labels?.[path];
  if (given) return given;
  // 맨 위(빈 path)는 정답지 전체다 — 값 하나가 통째로 정답인 경우.
  return path || "응답";
}

function labelFor(kind: AxisKind, path: string, labels?: Record<string, string>): string {
  const n = nameOf(path, labels);
  const tail = KIND_LABEL[kind];
  return tail ? `${n} ${tail}` : n;
}

/**
 * 갈래 수로 열의 역할을 가른다.
 *
 * 갈래와 식별자를 가르는 건 가짓수 자체가 아니라 '값이 겹치는가' 다. 주문번호는
 * 스무 건이면 스무 가지고, 상태는 스무 건이어도 네 가지에 머문다. 그래서 겹치는
 * 건이 전체의 1/3은 되어야 갈래로 친다 — 일곱 건에 네 가지(세 건이 겹침)는 갈래지만,
 * 일곱 건에 여섯 가지(한 건만 겹침)는 우연히 같은 금액이 두 번 나온 것에 가깝다.
 *
 * 가짓수 상한을 따로 두는 건 다른 이유에서다. 백 건이 열두 갈래로 고르게 갈리면
 * 그건 분명 축이지만, 목적 한 줄에 담아 읽히지는 않는다.
 *
 * 애매한 자리는 자유값 쪽에 둔다: 목적을 못 짓는 건 LLM 으로 넘어가면 그만이지만,
 * 엉뚱한 축으로 지어 놓으면 폴더 전체가 같은 모양으로 틀린다.
 */
export function roleOf(distinct: number, present: number): AxisRole {
  if (distinct <= 1) return "fixed";
  if (distinct > SPLIT_MAX) return "free";
  return present - distinct >= Math.ceil(present / REPEAT_SHARE) ? "split" : "free";
}

/** 이 열의 값이 저마다의 입력 글 안에 들어 있는가 — ECHO_SHARE 설명 참고.
 * 원값 열에만 뜻이 있다: 길이나 부호가 질문에 적혀 있을 리 없다. */
function isEcho(col: AxisColumn, shapes: CaseShape[]): boolean {
  if (col.kind !== "value" || col.distinct < 2) return false;
  const q = new Map(shapes.map((s) => [s.id, s.question]));
  let eligible = 0;
  let hits = 0;
  for (const [id, cell] of col.cells) {
    const text = cell.text.trim();
    const question = q.get(id) ?? "";
    if (!question || text.length < ECHO_MIN_LEN || text.length > ECHO_MAX_LEN) continue;
    eligible++;
    if (question.includes(text.toLowerCase())) hits++;
  }
  // 값 대부분이 길이 때문에 빠진 열을 남은 한두 건의 적중으로 올리지 않는다.
  if (eligible < Math.max(2, Math.ceil(col.present / 2))) return false;
  return hits / eligible >= ECHO_SHARE;
}

interface CaseShape {
  id: number;
  /** 입력 글을 눌러 놓은 것 — 되비침을 찾을 때만 쓴다. */
  question: string;
  leaves: Map<string, JsonLeaf>;
  arrays: Map<string, number>;
  /** 이 건에 있는 모든 path — 잎과 배열 노드를 합친 것. 유무 축의 바탕이다. 배열
   * 노드를 빼면 `items` 가 빈 배열인 건에서만 '있음' 이 되어 거꾸로 읽힌다. */
  universe: Set<string>;
}

/** 값 하나가 '비었다' 고 할 만한가 — null, 빈 문자열, 빈 배열, 빈 객체. */
function isBlank(leaf: JsonLeaf): boolean {
  return leaf.type === "null" || leaf.text === "" || leaf.text === "[]" || leaf.text === "{}";
}

const FENCE = /^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?\s*```$/;

/** ```json 펜스를 벗긴다. */
function stripFence(s: string): string {
  const m = FENCE.exec(s);
  return m ? m[1].trim() : s;
}

/** 앞뒤 군말을 떼고 괄호 한 쌍만 남긴다. 문자열 안의 괄호는 세지 않는다 —
 * `{"msg":"}"}` 를 반 토막 내면 안 된다. */
function sliceJson(s: string): string | null {
  const start = s.search(/[{[]/);
  if (start < 0) return null;
  const open = s[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return s.slice(start, i + 1);
  }
  return null;
}

/** 파이썬 쪽에서 찍어 낸 흔적과 남는 쉼표를 지운다. 문자열 안은 건드리지 않는다. */
function repairJson(s: string): string {
  let out = "";
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      out += ch;
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      out += ch;
      continue;
    }
    // 닫는 괄호 앞의 쉼표는 JSON 이 허락하지 않는다.
    if (ch === ",") {
      const rest = s.slice(i + 1);
      if (/^\s*[}\]]/.test(rest)) continue;
      out += ch;
      continue;
    }
    const word = /^(True|False|None|NaN|Infinity|-Infinity)\b/.exec(s.slice(i));
    if (word) {
      out += { True: "true", False: "false", None: "null" }[word[1]] ?? "null";
      i += word[1].length - 1;
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * 엄격한 JSON 으로 안 읽히는 정답지를 한 겹 더 벗겨 본다.
 *
 * 정답을 사람이 손으로 붙여 넣은 데이터셋에서 JSON 이 맨몸으로 있는 일은 드물다.
 * ```json 펜스에 싸여 있거나, "아래와 같이 반환됩니다:" 가 앞에 붙거나, 파이썬 쪽에서
 * 찍어 낸 True/None 과 작은따옴표가 섞여 있다. 눈으로는 JSON 인데 JSON.parse 는
 * 거부하고, 그러면 축이 한 줄도 안 잡혀 폴더 전체가 LLM 으로 넘어간다.
 *
 * 채점(structuredMatch)은 이 손을 쓰지 않는다. 일치/불일치의 기준을 느슨하게 만드는
 * 건 전혀 다른 이야기고, 여기서 하는 일은 목적을 지으려고 모양만 들여다보는 것이다.
 */
function looseText(raw: string): string | null {
  const body = sliceJson(stripFence(raw));
  if (body === null) return null;
  // 큰따옴표가 하나도 없으면 파이썬 repr 이다. 그때만 작은따옴표를 바꾼다 —
  // 섞여 있을 때 바꾸면 값 안의 아포스트로피까지 따옴표가 되어 더 망가진다.
  const quoted = body.includes('"') ? body : body.replace(/'/g, '"');
  return repairJson(quoted);
}

function shapeOf(c: PurposeCase, unwrapBody?: boolean): CaseShape | null {
  const raw = (c.ground_truth ?? "").trim();
  if (!raw) return null;
  const opts = unwrapBody === undefined ? {} : { unwrapBody };
  let value = jsonValueOf(raw, opts);
  if (value === undefined) {
    const relaxed = looseText(raw);
    if (relaxed !== null) value = jsonValueOf(relaxed, opts);
  }
  if (value === undefined) return null;
  const { leaves, arrays } = jsonShape(value);
  const byPath = new Map<string, JsonLeaf>();
  for (const l of leaves) byPath.set(l.path, l);
  return {
    id: c.case_id,
    question: (c.question ?? "").replace(/\s+/g, " ").trim().toLowerCase(),
    leaves: byPath,
    arrays,
    universe: new Set([...byPath.keys(), ...arrays.keys()]),
  };
}

/**
 * 폴더 하나를 분석해 열과 케이스별 목적을 돌려준다.
 *
 * 폴더로 끊어 부르는 건 '같은 폴더에 넣었다' 는 것 자체가 이미 사람이 해 둔 갈래
 * 나누기라서다. 폴더가 다르면 키 집합도 달라 한 표에 세울 수 없다.
 */
export function analyzeFolder(cases: PurposeCase[], opts: AxisOpts = {}): FolderAxes {
  const labels = opts.labels;
  const lineAxes = Math.max(1, opts.lineAxes ?? DEFAULT_LINE_AXES);
  const maxLen = Math.max(8, opts.maxLen ?? DEFAULT_MAX_LEN);

  const shapes: CaseShape[] = [];
  const unparsed: number[] = [];
  for (const c of cases) {
    const s = shapeOf(c, opts.unwrapBody);
    if (s) shapes.push(s);
    else unparsed.push(c.case_id);
  }

  // 한 건짜리 폴더에는 견줄 형제가 없다. 갈래가 나올 수 없으니 표를 세울 것도 없다.
  if (shapes.length < 2) {
    return {
      folder: opts.folder ?? "",
      cases: cases.length,
      parsed: shapes.length,
      unparsed,
      columns: [],
      splits: [],
      fixed: [],
      outliers: [],
      purposes: new Map(),
    };
  }

  // path 순서는 첫 케이스의 정답지에 적힌 키 순서다 — 미리보기 표가 정답지를 읽는
  // 것처럼 읽힌다. 뒤 케이스에만 있는 키는 그 뒤에 붙는다.
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const s of shapes) {
    for (const p of s.leaves.keys()) {
      if (!seen.has(p)) {
        seen.add(p);
        paths.push(p);
      }
    }
    for (const p of s.arrays.keys()) {
      if (!seen.has(p)) {
        seen.add(p);
        paths.push(p);
      }
    }
  }

  const columns: AxisColumn[] = [];
  const make = (kind: AxisKind, path: string): AxisColumn => {
    const col: AxisColumn = {
      id: `${kind}:${path}`,
      path,
      kind,
      label: labelFor(kind, path, labels),
      role: "fixed",
      cells: new Map(),
      distinct: 0,
      present: 0,
      echo: false,
      quoted: false,
    };
    columns.push(col);
    return col;
  };
  const put = (col: AxisColumn, id: number, text: string): void => {
    col.cells.set(id, { text, key: text });
  };

  for (const path of paths) {
    const value = make("value", path);
    const blank = make("blank", path);
    const sign = make("sign", path);
    const type = make("type", path);
    const length = make("length", path);

    for (const s of shapes) {
      const leaf = s.leaves.get(path);
      if (leaf) {
        // 원값만 표시용과 열쇠를 따로 쓴다: 200 과 "200" 이 한 값으로 뭉치면 갈리는
        // 열이 고정값으로 보인다.
        value.cells.set(s.id, { text: leaf.text, key: leaf.key });
        put(blank, s.id, isBlank(leaf) ? "없음" : "있음");
        put(type, s.id, leaf.type);
        if (leaf.type === "number") {
          const n = Number(leaf.text);
          if (Number.isFinite(n)) put(sign, s.id, n === 0 ? "0" : n > 0 ? "양수" : "음수");
        }
      }
      const len = s.arrays.get(path);
      if (len !== undefined) put(length, s.id, String(len));
    }

    // 유무 축은 배열 바깥에서만 뜻이 있다. 배열 안쪽 키가 어떤 건에만 있는 건 그
    // 배열이 짧다는 말이고, 길이 축이 이미 하고 있는 말이다.
    if (!insideArray(path)) {
      const present = make("present", path);
      for (const s of shapes) put(present, s.id, s.universe.has(path) ? "있음" : "없음");
    }
  }

  const live = columns.filter((c) => c.cells.size > 0);
  for (const c of live) {
    c.present = c.cells.size;
    const keys = new Set<string>();
    const texts = new Set<string>();
    for (const cell of c.cells.values()) {
      keys.add(cell.key);
      texts.add(cell.text);
    }
    c.distinct = keys.size;
    // 표시용 값은 겹치는데 열쇠가 갈린다면 타입만 다른 값이 섞여 있다는 뜻이다.
    // 그대로 적으면 서로 다른 지점을 확인하는 두 건의 목적이 글자까지 같아진다.
    c.quoted = texts.size < keys.size;
    c.role = roleOf(c.distinct, c.present);
    c.echo = isEcho(c, shapes);
  }

  const order = new Map(live.map((c, i) => [c.id, i]));
  const byId = new Map(live.map((c) => [c.id, c]));

  let splits: AxisColumn[];
  if (opts.pick && opts.pick.length) {
    splits = [];
    for (const id of opts.pick) {
      const c = byId.get(id);
      if (c) splits.push(c);
    }
  } else {
    const floor = Math.ceil(shapes.length * COVERAGE_MIN);
    const auto = live.filter((c) => c.role === "split" && c.present >= floor);
    // 같은 path 의 원값이 이미 갈래를 보여 주면 거기서 뽑은 특성은 같은 말을 두 번
    // 한다 — `status=DONE` 옆의 `status 값 있음` 은 아무것도 보태지 않는다.
    const rawSplit = new Set(auto.filter((c) => c.kind === "value").map((c) => c.path));
    splits = auto.filter((c) => c.kind === "value" || !rawSplit.has(c.path));
    // 모든 건을 덮는 축이 먼저, 그다음은 갈래가 많은 축 — 네 갈래로 갈리는 열이 이
    // 폴더가 무엇을 가르는지 두 갈래짜리보다 많이 말해 준다. 마지막 기준이 정답지에
    // 적힌 순서라 같은 폴더를 두 번 분석해도 같은 목적이 나온다.
    splits.sort(
      (a, b) =>
        b.present - a.present ||
        b.distinct - a.distinct ||
        (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
    );
    // 입력을 되비추는 열은 갈래 수를 따지지 않고 끼워 넣는다. 전건이 달라 자유값으로
    // 갈렸더라도 그건 이 건이 무엇에 관한 것인지를 말하고 있고, 값이 저마다 다르니
    // 변별력이 높아 문장 앞자리를 차지한다 — `city=서울 · unit=C` 처럼 주제가 먼저,
    // 어느 갈래인지가 뒤에 온다.
    const taken = new Set(splits.map((c) => c.id));
    splits = [...live.filter((c) => c.echo && c.present >= floor && !taken.has(c.id)), ...splits];
  }

  const purposes = new Map<number, string>();
  const chosen = Boolean(opts.pick && opts.pick.length);
  for (const s of shapes) {
    const line = lineFor(s.id, splits, lineAxes, maxLen, chosen, labels);
    if (line) purposes.set(s.id, line);
  }

  return {
    folder: opts.folder ?? "",
    cases: cases.length,
    parsed: shapes.length,
    unparsed,
    columns: live,
    splits,
    fixed: live.filter(
      (c) => c.kind === "value" && c.role === "fixed" && c.present === shapes.length,
    ),
    outliers: outliersOf(shapes),
    purposes,
  };
}

/**
 * 한 건의 목적 한 줄. 쓸 축이 하나도 없으면 null — 부르는 쪽이 LLM 으로 넘길 몫이다.
 *
 * `chosen` 은 축을 사람이 골랐다는 뜻이다. 그때는 고른 순서대로, 문턱도 재지 않고
 * 그대로 적는다 — 폴더 전체를 한 틀로 맞추려고 고른 것이라 어떤 건에서는 빠지고
 * 어떤 건에서는 들어오면 틀이 되지 않는다.
 */
function lineFor(
  id: number,
  splits: AxisColumn[],
  lineAxes: number,
  maxLen: number,
  chosen: boolean,
  labels?: Record<string, string>,
): string | null {
  const mine: { col: AxisColumn; cell: AxisCell; rank: number; rarity: number }[] = [];
  for (let i = 0; i < splits.length; i++) {
    const col = splits[i];
    const cell = col.cells.get(id);
    if (!cell) continue;
    // 변별력 = 같은 값을 나눠 갖는 형제가 적을수록 크다. 스무 건 중 나만 CANCELLED
    // 인 쪽이, 절반이 같은 값인 쪽보다 이 건을 더 잘 말해 준다. 기존 프롬프트의
    // "여러 건에 같은 문장을 쓰지 마세요" 가 여기서 계산으로 바뀐다.
    let same = 0;
    for (const other of col.cells.values()) if (other.key === cell.key) same++;
    mine.push({ col, cell, rank: i, rarity: 1 - same / col.present });
  }
  if (mine.length === 0) return null;
  if (chosen) {
    const kept = mine.slice(0, lineAxes);
    return clip(`${kept.map((x) => phrase(x.col, x.cell, labels)).join(" · ")} 확인`, maxLen);
  }

  // 변별력이 같으면 폴더의 주된 축을 앞에 둔다. `status=CANCELLED · refund.fee=500`
  // 이 그 반대보다 읽힌다 — 무엇에 관한 건인지가 먼저 오기 때문이다.
  mine.sort((a, b) => b.rarity - a.rarity || b.col.distinct - a.col.distinct || a.rank - b.rank);
  // 첫 축은 변별력이 낮아도 쓴다 — 가진 것 중 가장 나은 말이다. 두 번째부터는 문턱을
  // 넘어야 한다: 스무 건 중 열아홉 건이 같은 값인 축을 뒤에 붙여 봐야 `status=A ·
  // vip=false` 처럼 앞말만 되풀이하는 줄이 된다. 변별력 순으로 정렬돼 있으니 문턱에
  // 걸리는 순간 뒤는 볼 것도 없다.
  const take = [mine[0]];
  for (let i = 1; i < mine.length && take.length < lineAxes; i++) {
    if (mine[i].rarity < MIN_EXTRA_RARITY) break;
    take.push(mine[i]);
  }
  return clip(`${take.map((x) => phrase(x.col, x.cell, labels)).join(" · ")} 확인`, maxLen);
}

/** 축 하나를 목적 문장의 한 토막으로. 열의 종류마다 읽히는 말이 다르다. */
function phrase(col: AxisColumn, cell: AxisCell, labels?: Record<string, string>): string {
  const n = nameOf(col.path, labels);
  switch (col.kind) {
    case "value":
      return `${n}=${clip(col.quoted ? cell.key : cell.text, VALUE_MAX)}`;
    case "present":
      return cell.text === "있음" ? `${n} 반환` : `${n} 미반환`;
    case "length":
      return `${n} ${cell.text}건`;
    case "blank":
      return `${n} 값 ${cell.text}`;
    case "sign":
      return `${n} ${cell.text}`;
    case "type":
      return `${n} 타입 ${cell.text}`;
  }
}

/** 형제 대다수와 키 집합이 다른 건을 집어낸다. 최빈 키 집합을 폴더의 모양으로 보고,
 * 거기서 벗어난 건만 그 차이와 함께 돌려준다. */
function outliersOf(shapes: CaseShape[]): SchemaOutlier[] {
  const sigOf = new Map<number, string>();
  const setOf = new Map<number, Set<string>>();
  const tally = new Map<string, number>();
  for (const s of shapes) {
    const keys = new Set([...s.universe].map(collapseIdx));
    const sig = [...keys].sort().join("\n");
    sigOf.set(s.id, sig);
    setOf.set(s.id, keys);
    tally.set(sig, (tally.get(sig) ?? 0) + 1);
  }

  // 같은 수로 갈리면 앞선 케이스의 모양을 택한다 — 순서만으로 결과가 흔들리지 않게.
  let modal = "";
  let best = -1;
  for (const s of shapes) {
    const sig = sigOf.get(s.id) ?? "";
    const n = tally.get(sig) ?? 0;
    if (n > best) {
      best = n;
      modal = sig;
    }
  }
  const modalKeys = new Set(modal ? modal.split("\n") : []);

  const out: SchemaOutlier[] = [];
  for (const s of shapes) {
    if (sigOf.get(s.id) === modal) continue;
    const keys = setOf.get(s.id) ?? new Set<string>();
    // 배열이 빈 건에는 그 안쪽 키가 있을 자리가 없다. 없는 게 아니라 물을 데가
    // 없는 것이라, 목록이 짧다는 이유로 스키마가 어긋났다고 하면 안 된다.
    const na: string[] = [];
    for (const [p, n] of s.arrays) if (n === 0) na.push(`${p}[]`);
    const missing = [...modalKeys].filter(
      (k) => !keys.has(k) && !na.some((pre) => k.startsWith(pre)),
    );
    const extra = [...keys].filter((k) => !modalKeys.has(k));
    if (missing.length === 0 && extra.length === 0) continue;
    out.push({ case_id: s.id, missing, extra });
  }
  return out;
}

/**
 * 축이 하나도 안 잡힌 이유를 한 줄로. 잡혔으면 null.
 *
 * 이게 없으면 "정답이 JSON 인데 왜 LLM 이 답했지?" 에 답할 길이 없다. 규칙이 네 개고
 * 어느 문턱에 걸렸는지는 숫자를 봐야 아는데, 그 숫자는 여기에만 있다.
 */
export function whyNoAxes(f: FolderAxes): string | null {
  if (f.splits.length > 0) return null;
  if (f.parsed === 0) {
    return `정답지가 JSON 이 아닙니다 (${f.cases}건 전부). 정답이 산문이면 축을 셀 수 없습니다`;
  }
  if (f.parsed < 2) {
    return `견줄 형제가 없습니다 — 이 폴더에 JSON 정답이 ${f.parsed}건뿐입니다`;
  }
  const brief = (cols: AxisColumn[]) =>
    cols.slice(0, DESC_ITEMS).map((c) => `${c.label} ${c.distinct}가지/${c.present}건`).join(", ");

  // 갈래로 갈리기는 했는데 폴더의 절반을 못 덮은 경우 — 폴더 안에 키 모양이 다른
  // 무리가 섞여 있다는 뜻이라, 폴더를 나누면 바로 잡힌다.
  const narrow = f.columns.filter((c) => c.role === "split");
  if (narrow.length > 0) {
    return `갈래가 보이는 열은 있으나 폴더의 절반을 덮지 못했습니다 (${brief(narrow)}) — ` +
      `한 폴더에 키 모양이 다른 무리가 섞여 있습니다`;
  }
  const free = f.columns.filter((c) => c.kind === "value" && c.role === "free");
  if (free.length > 0) {
    return `값이 건마다 제각각이라 갈래로 볼 열이 없습니다 (${brief(free)}) — ` +
      `겹치는 값이 전체의 1/3은 되어야 갈래로 봅니다`;
  }
  return "모든 열이 전건 같은 값입니다 — 정답지끼리 서로 다르지 않습니다";
}

/** 폴더 자체를 한 줄로 — 전제와 갈래. 데이터셋 목적을 LLM 없이 짓는 씨앗이다. */
export function describeFolder(f: FolderAxes): string {
  if (f.parsed === 0) return "정답지가 JSON 이 아니어서 축을 볼 수 없습니다";
  const premise = f.fixed.slice(0, DESC_ITEMS).map((c) => {
    const first = c.cells.values().next().value;
    return `${c.label}=${clip(first ? first.text : "", VALUE_MAX)}`;
  });
  const axes = f.splits.slice(0, DESC_ITEMS).map((c) => c.label);
  return [
    `${f.parsed}건`,
    premise.length ? `공통 ${premise.join(" · ")}` : null,
    axes.length ? `갈래 ${axes.join(" · ")}` : "갈래 없음",
  ]
    .filter(Boolean)
    .join(" / ");
}
