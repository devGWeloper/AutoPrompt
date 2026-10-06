/**
 * 값 한 조각을 클립보드로 넘긴다.
 *
 * `navigator.clipboard` 는 보안 컨텍스트(https 또는 localhost)에서만 존재한다.
 * 사내망에서 `http://<호스트>:5175` 로 열면 이 객체가 아예 undefined 라서,
 * `navigator.clipboard?.writeText(...)` 는 아무 일도 하지 않고 조용히 지나간다 —
 * 버튼은 눌리는데 복사만 안 되는 모양이 그래서 나온다.
 *
 * 그래서 옛 방식(`document.execCommand('copy')`)을 받침으로 둔다. 폐기 예정
 * API 지만 http 로 뜬 페이지에서 지금 동작하는 유일한 길이고, 두 방법이 모두
 * 막히면 호출한 쪽이 알 수 있게 false 를 돌려준다 — 실패를 말해 주지 않으면
 * 사용자는 복사된 줄 알고 빈 클립보드를 붙여넣는다.
 */
export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 권한을 거부당했거나 문서가 포커스를 잃은 경우 — 아래로 넘어간다.
    }
  }
  return execCopy(text);
}

/** 화면에 띄우지 않고 선택만 할 수 있는 입력칸을 한 번 만들어 쓰고 버린다.
 * `display:none` 이나 `visibility:hidden` 은 선택이 되지 않아 쓸 수 없고,
 * `position:fixed` 는 긴 값을 담아도 문서가 스크롤되지 않게 한다. */
function execCopy(text: string): boolean {
  if (typeof document === 'undefined') return false;
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.setAttribute('aria-hidden', 'true');
  ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0;';
  document.body.appendChild(ta);

  // 누르기 전 포커스를 돌려줘야 표를 훑던 자리가 유지된다.
  const prev = document.activeElement as HTMLElement | null;
  let ok = false;
  try {
    ta.select();
    ta.setSelectionRange(0, text.length);
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  prev?.focus?.();
  return ok;
}
