---
version: 1
name: inview-design-language
description: >
  TestX 의 시각 언어. 원본은 사내 inview 앱(`C:\work\inview`, `src/app/globals.css`) —
  옅은 회색 캔버스 위에 흰 패널, 헤어라인 크롬, 파란색 액센트 하나, 그리고 상태를
  솔리드 소프트 틴트(soft/line/vivid 3단)로 표현하는 중립적 엔터프라이즈 콘솔 톤.
  토큰 구현은 `tailwind.config.ts` + `src/app/globals.css`.
---

# 원칙

1. **캔버스는 회색, 패널은 흰색.** 배경 `#f4f5f7` 위에 `#ffffff` 패널이 떠 있고,
   경계는 그림자가 아니라 1px 헤어라인(`#e1e4e8`)이 만든다. 그림자는
   `0 1px 0 rgba(17,24,39,.02)` 수준으로만 존재한다.
2. **액센트는 파랑 하나.** `#2563eb` 가 주 동작(CTA) · 활성 탭 · 선택 행 · 포커스
   링을 전부 담당한다. 니어블랙은 텍스트 색이지 버튼 색이 아니다.
3. **상태는 3단으로 온다.** `soft`(면) · `line`(테두리) · `DEFAULT`(글자) ·
   `vivid`(점). 알파 오버레이를 쓰지 않으므로 CSS Color 4 미지원 브라우저에서도
   틴트가 그대로 칠해진다.
4. **라벨은 대문자 + 양의 자간.** 표 헤더 · 필드 라벨 · KPI 제목은 12.5px / 600 /
   `letter-spacing: .7px` 대문자(`.eyebrow`).
5. **숫자는 모노.** KPI 값, 점수, 버전, 지연시간은 전부 모노스페이스 + tabular-nums.
6. **기하는 두 스텝.** 버튼 · 입력 · 배지 6px, 패널 · 카드 8px(KPI 카드 11px,
   세그먼트 트랙 9px). 알약(999px)은 상태 칩과 원형 아이콘 전용.

# 토큰

| 역할 | 값 | Tailwind |
|---|---|---|
| 캔버스 | `#f4f5f7` | `bg-bg` |
| 서피스 | `#ffffff` / `#fafbfc` / `#f0f2f5` | `bg-surface` / `-2` / `-3` |
| 헤어라인 | `#e1e4e8` / `#d0d4da` | `border-line` / `-strong` |
| 본문 | `#1f2328` / `#4b5563` / `#6b7280` / `#8a94a6` | `text-ink` / `body` / `muted` / `muted-soft` |
| 액센트 | `#2563eb` (soft `#e8efff`, line `#c3d4fc`, deep `#1d4ed8`) | `accent`, `primary` |
| 성공 | `#067647` / `#e6f4ec` / `#bfe3ce` / `#16a34a` | `ok` `-soft` `-line` `-vivid` |
| 경고 | `#b54708` / `#fdf2e5` / `#f1d6ba` / `#f59e0b` | `warn` … |
| 오류 | `#b42318` / `#fdecec` / `#f4c1bc` / `#ef4444` | `bad` … |
| 실패(중단·낙제) | `#c2410c` / `#ffedd5` / `#fed7aa` / `#f97316` | `fail` … |

각 상태색은 hover 한 단계 짙은 틴트 `-soft2` 를 함께 가진다(예 `hover:bg-bad-soft2`).

크로마(purple `#7c3aed` / blue `#2563eb` / pink `#be185d` / orange `#b45309` /
green `#067647`)는 **분류 표식과 그라데이션 전용**이다. 버튼 배경으로 쓰지 않는다.
브랜드 마크와 활성 탭 밑줄의 blue→violet 그라데이션이 유일한 예외.

# 타이포

시스템 UI 스택(`-apple-system` → `Segoe UI` → `Noto Sans KR` → `Malgun Gothic`).
사내망은 폐쇄망이라 웹폰트를 받지 못하므로 설치된 얼굴에 반드시 착지해야 한다.
본문 16px / 1.6, 자간 0. 음의 자간은 24px 이상 제목에만.

| 키 | 크기 | 용도 |
|---|---|---|
| `text-display-lg` | 24px / 700 | 화면 제목(`PageHeader`) |
| `text-display-sm` | 17px / 700 | 히어로 카드 제목 |
| `text-display-xs` | 16px / 600 | 패널 · 모달 제목 |
| `text-body-sm` | 14px | 본문 · 표 |
| `text-caption` | 12.5px / 600 | 대문자 라벨 |

# 컴포넌트 규칙

- **버튼** — 6px, weight 500, 헤어라인. primary 는 파란 면, secondary 는 흰 면 +
  `border-line-strong`, ghost 는 테두리 없음. 포커스는 파란 테두리 + 3px 15% 헤일로.
- **입력** — 6px, `border-line-strong`, 포커스 시 파란 테두리 + `shadow-ring`.
- **배지** — 알약. soft 면 + line 테두리 + 같은 색 글자, 선택적 7px 점(vivid).
- **표** — 헤더는 `bg-surface-2` 위 대문자 라벨, 셀마다 아래 헤어라인, 행 hover 는
  `bg-surface-2`, 선택 행은 `bg-accent-soft` + 좌측 3px 액센트 바.
- **세그먼트 탭** — `bg-surface-3` 트랙(9px) 안에 흰 키(6px). 활성 키는 파란 글자 +
  `shadow-seg` + blue→violet 그라데이션 밑줄.
- **KPI 카드** — 11px 라운드, 좌측 3px 톤 레일(점수 색), 대문자 제목, 큰 모노 값.
- **사이드바** — 흰 서피스, 상단 64px 브랜드 블록(그라데이션 마크 + `Test`+그라데이션 `X`),
  활성 행은 `bg-accent-soft` + 좌측 3px 바, 하단은 env · DB · 버전 상태바.
