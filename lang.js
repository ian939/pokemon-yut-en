/* 🌐 언어 설정 — 한국어판(pokemon-yut)·영어판(pokemon-yut-en) 두 저장소에 똑같이 둔다 (사용자 확정 2026-10-11)
 *   "ko"    한국어판
 *   "en"    영어판
 *   "en-ko" 영어판 + 기술 이름만 한국어
 * - 설정은 같은 주소(ian939.github.io)라 두 판이 같이 읽는 localStorage "pokemon_yut_lang" 에 둔다. 부모 모드에서만 바꾼다.
 * - 페이지를 열 때 설정과 다른 판이면 맞는 판 주소로 바로 옮긴다 (/pokemon-yut/ ↔ /pokemon-yut-en/). 주소가 그 꼴이 아니면(로컬 시험) 옮기지 않는다.
 * - 잡은 포켓몬·볼·프로필·하던 판은 두 판이 같은 저장(engmon_yut_v1)을 쓴다.
 */
(function () {
  var KEY = "pokemon_yut_lang";
  var PATHS = { ko: "/pokemon-yut/", en: "/pokemon-yut-en/" };
  function get() { try { var v = localStorage.getItem(KEY); return v === "ko" || v === "en" || v === "en-ko" ? v : null; } catch (e) { return null; } }
  function set(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }
  var site = location.pathname.indexOf(PATHS.en) >= 0 ? "en" : location.pathname.indexOf(PATHS.ko) >= 0 ? "ko" : null;
  // 이 언어 설정이면 어느 판 주소로 가야 하나 (지금 판이면 null)
  function target(v) {
    var want = v === "ko" ? "ko" : "en";
    if (!site || want === site) return null;
    return location.pathname.replace(PATHS[site], PATHS[want]) + location.search + location.hash;
  }
  var pref = get(), go = pref && target(pref);
  if (go) location.replace(go);
  window.YutLang = { get: get, set: set, site: site, target: target, moving: !!go };
})();
