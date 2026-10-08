/* 패드에서 실수로 일어나는 확대·축소·복사를 막는다.
 *
 * 아이나 전시 관람객이 패드를 쓰다 보면 손가락 두 개가 같이 닿아 화면이 커지거나,
 * 글자를 오래 눌러 '복사 / 찾아보기' 메뉴가 뜨거나, 두 번 두드려 확대된다.
 * 한 번 그렇게 되면 혼자서는 원래대로 돌리지 못해 화면이 망가진 채로 남는다.
 *
 * 막는 방법을 겹쳐 둔다 — 브라우저마다 듣는 수단이 다르다:
 *   1) index.html 의 viewport (user-scalable=no, maximum-scale=1)
 *   2) CSS touch-action: pan-x pan-y  → 두 번 두드려 확대·손가락 확대 차단
 *   3) 여기의 gesture* 막기 (iOS 사파리는 위 두 개를 무시할 때가 있다)
 *   4) 손가락이 둘 이상인 touchmove 막기 (마지막 그물)
 *
 * 글자 칸(input/textarea/contenteditable) 안에서는 아무것도 막지 않는다 —
 * 글자를 고치려면 선택도 되고 길게 눌러 커서를 옮길 수도 있어야 한다.
 *
 * 주의: 두 번 두드려 확대를 touchend 를 막아 해결하지 말 것.
 *       빠르게 두 번 누르는 조작까지 죽는다 (합성 click 이 안 나간다).
 *       touch-action 이 이미 그걸 막아 준다.
 */
(function () {
  'use strict';

  const stop = (e) => { e.preventDefault(); };

  /** 글자를 다루는 칸인지 (여기서는 평소처럼 동작해야 한다) */
  function isTextField(node) {
    let el = node;
    while (el && el !== document) {
      if (el.nodeType === 1) {
        const tag = el.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable) return true;
      }
      el = el.parentNode;
    }
    return false;
  }

  /* --- 손가락 확대 (iOS 사파리) --- */
  ['gesturestart', 'gesturechange', 'gestureend'].forEach((type) => {
    document.addEventListener(type, stop, { passive: false });
  });

  /* --- 손가락이 둘 이상이면 아예 넘기지 않는다 --- */
  // 한 손가락은 건드리지 않는다 — 글씨 쓰기와 화면 넘기기가 그걸로 된다
  document.addEventListener('touchmove', (e) => {
    if (e.touches && e.touches.length > 1) e.preventDefault();
  }, { passive: false });

  /* --- 길게 눌러 뜨는 복사·찾아보기 메뉴 --- */
  document.addEventListener('contextmenu', (e) => {
    if (!isTextField(e.target)) e.preventDefault();
  });

  /* --- 글자 선택과 끌어 옮기기 --- */
  document.addEventListener('selectstart', (e) => {
    if (!isTextField(e.target)) e.preventDefault();
  });
  document.addEventListener('dragstart', (e) => {
    if (!isTextField(e.target)) e.preventDefault();
  });

  /* --- 키보드나 트랙패드가 붙어 있을 때의 확대 --- */
  document.addEventListener('wheel', (e) => {
    if (e.ctrlKey) e.preventDefault();
  }, { passive: false });
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (['+', '=', '-', '_', '0'].indexOf(e.key) >= 0) e.preventDefault();
  });
})();
