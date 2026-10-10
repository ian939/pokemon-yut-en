"""화면 검사 (Playwright + Chromium). 로컬 HTTP 서버를 스스로 띄워 실제로 판을 끝까지 둔다.

    PYTHONIOENCODING=utf-8 PYTHONUTF8=1 python tools/test-ui.py [스크린샷 폴더]

확인하는 것
  1. 가족 대결: 처음 → 준비 → 팀 2개 고르기 → 판을 끝까지 → 우승 화면 (가로 1180×820)
  2. 로켓단 대결: 등장 연출 → 컴퓨터가 스스로 둔다 → 끝까지 (세로 820×1180)
  3. 이어하기: 판 중간에 새로고침 → 같은 차례·같은 위치
  4. 고르기 명단: 스타팅 포켓몬 27마리 + ❓ 풀숲에서 잡은 포켓몬(잡은 순서대로) / 같은 진화 가족 막기
  5. 새 버전 감지: 서버 파일의 APP_VERSION 이 다르면 알림
  6. 누르는 것 44×44px 이상, 가로 스크롤 없음 (폰 390×844 포함)
  7. 콘솔 오류 0개
  9. v4: 🕐 시계 문제 세 번(정각 → 15·30·45분 → 몇 시 몇 분, 맞힐수록 유니크·전설 ↑ · 틀림 → 풀이) · 💰 돈 문제(볼 하나 더 · 한 번 더) · 공부 끄기 · 15칸 기술 · 공부 기록
  8. v3: ✨ 기술 켜기/끄기 · 배우기 · 쓰기(바로·상대 말·결과·빈 칸) · 저절로 기술 · 잡은 포켓몬으로 말 바꾸기 · 로켓단 그물 · 기술 도감
"""
import functools
import http.server
import json
import pathlib
import re
import sys
import threading
import time

from playwright.sync_api import sync_playwright, Page

# 👤 처음엔 프로필이 하나뿐 — 가족 대결 시험은 예전처럼 가족 6명으로 (?fam=1). 하나뿐인 경우는 scenario_save 에서 ?fam=0 으로 따로 본다
_goto = Page.goto
def _goto_fam(self, url, **kw):
    if "/index.html" in url and "fam=" not in url and "127.0.0.1" in url:
        url += ("&" if "?" in url else "?") + "fam=1"
    return _goto(self, url, **kw)
Page.goto = _goto_fam

for s in (sys.stdout, sys.stderr):
    try:
        s.reconfigure(encoding="utf-8")
    except Exception:
        pass

ROOT = pathlib.Path(__file__).resolve().parent.parent
_args = [a for a in sys.argv[1:] if not a.startswith("--")]
OUT = pathlib.Path(_args[0]) if _args else ROOT / "art-src" / "shots"
OUT.mkdir(parents=True, exist_ok=True)

fails = []
SKIPS = [0]  # play_to_end 에서 누른 배틀 건너뛰기 수


def check(cond, msg):
    print(("✅ " if cond else "❌ ") + msg)
    if not cond:
        fails.append(msg)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def serve():
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(ROOT)))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


# 윷놀이 저장 흉내: ❓ 풀숲에서 잡은 포켓몬 (잡은 순서: 리자드 → 가디 → 이브이)
YUT_SAVE = json.dumps({"collection": [{"id": 5, "t": 1, "from": "wild"}, {"id": 58, "t": 2, "from": "wild"}, {"id": 133, "t": 3, "from": "wild"}]})

MEASURE = """() => {
  const bad = [];
  const sel = 'button:not([disabled]), .unit, .dest, [data-act]:not([disabled])';
  document.querySelectorAll(sel).forEach(el => {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none' || +st.opacity === 0) return;
    if (r.width < 43.5 || r.height < 43.5) bad.push((el.className || el.tagName) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' "' + (el.textContent || '').trim().slice(0, 12) + '"');
  });
  return { bad, hscroll: document.documentElement.scrollWidth > innerWidth + 1 };
}"""


def measure(page, name):
    m = page.evaluate(MEASURE)
    check(not m["bad"], f"{name}: 누르는 것 44px 이상" + ("" if not m["bad"] else " → " + "; ".join(m["bad"][:6])))
    check(not m["hscroll"], f"{name}: 가로 스크롤 없음")


def wait_idle(page, timeout=20000):
    # 🪙 시작 동전은 우리 패드에서 눌러 던진다 (빠르게 모드·친구 대결은 저절로)
    end = time.time() + timeout / 1000
    while not page.evaluate("() => !!(window.__yut && !window.__yut.G.busy)"):
        coin = page.query_selector(".coin-ov:not(.tossing) #ct-coin")
        if coin:
            coin.click(force=True)
        if time.time() > end:
            raise TimeoutError("wait_idle " + str(timeout))
        page.wait_for_timeout(100)


def wait_idle_or_popup(page, timeout=20000):
    """계산이 끝나거나, 배틀·야생 조우 창(건너뛰기 버튼)·문제 창이 뜰 때까지."""
    page.wait_for_function("() => window.__yut && (!window.__yut.G.busy || document.querySelector('.bt-skip') || document.querySelector('.quiz'))", timeout=timeout)


def answer_quiz(page, right=True, timeout=15000):
    """🎓 시계·돈 문제 창이 뜨면 답한다 (right=False 면 틀린 답 → 풀이 → 알겠어요!)."""
    page.wait_for_selector(".quiz .qz-choice:not([disabled])", timeout=timeout)
    box = page.query_selector(".quiz")
    page.click(".quiz .qz-choice[data-ok]" if right else ".quiz .qz-choice:not([data-ok])")
    if not right:
        page.wait_for_selector(".quiz .qz-next:not([hidden])", timeout=timeout)
        page.click(".quiz .qz-next")
    page.wait_for_function("e => !e.isConnected", arg=box, timeout=timeout)  # 이 문제 창이 닫힐 때까지 (다음 문제 창이 바로 뜰 수 있다)


def play_to_end(page, shots_prefix, max_steps=900):
    """사람 차례면 던지고 반짝이는 칸을 누른다. 컴퓨터 차례는 기다린다."""
    shot_at = {3, 12, 30}
    n = 0
    for step in range(max_steps):
        if page.query_selector(".quiz .qz-choice:not([disabled])"):
            page.click(".quiz .qz-choice")          # 🎓 문제: 아무거나 (맞든 틀리든 판이 이어져야 함)
            page.wait_for_timeout(80)
            continue
        if page.query_selector(".modal .gift-pick"):
            page.click(".modal .gift-pick")         # 🎁 못 쓴 기술을 받을 팀원
            page.wait_for_timeout(80)
            continue
        if page.query_selector(".quiz .qz-next:not([hidden])"):
            page.click(".quiz .qz-next")
            page.wait_for_timeout(80)
            continue
        sk = page.query_selector(".bt-skip")
        if sk:
            # 잡기 배틀이 뜨면 건너뛰기를 눌러 본다 (건너뛰어도 판이 이어져야 함)
            sk.click(force=True)
            SKIPS[0] += 1
            page.wait_for_timeout(80)
            continue
        st = page.evaluate("() => { const G = window.__yut.G; return G.s ? { phase: G.s.phase, cpu: G.s.teams[G.s.turn].cpu, busy: G.busy, dests: document.querySelectorAll('.dest:not(.cpu)').length, over: !!document.querySelector('.win-screen') } : null }")
        if not st:
            return False
        if st["over"]:
            return True
        if st["busy"] or st["cpu"]:
            page.wait_for_timeout(60)
            continue
        if st["phase"] == "throw":
            page.click("#btn-throw", force=True)
            n += 1
            if n in shot_at:
                page.wait_for_timeout(120)
                page.screenshot(path=str(OUT / f"{shots_prefix}-throw{n}.png"))
            wait_idle_or_popup(page)
        elif st["phase"] == "choose":
            if st["dests"] == 0:
                # 여러 말 중 고르는 상황: 반짝이는 말을 누른다
                target = page.query_selector(".unit.can") or page.query_selector(".pchip.can")
                if not target:
                    page.wait_for_timeout(60)
                    continue
                target.click()
                page.wait_for_timeout(40)
                if n in shot_at:
                    page.screenshot(path=str(OUT / f"{shots_prefix}-choose{n}.png"))
            dests = page.query_selector_all(".dest:not(.cpu)")
            if dests:
                # 잡기 > 골인 > 나머지 순으로 눌러 여러 연출이 나오게
                pick = None
                for cls in ("hit", "goal"):
                    pick = next((d for d in dests if cls in (d.get_attribute("class") or "")), None)
                    if pick:
                        break
                (pick or dests[-1]).click(force=True)
                wait_idle_or_popup(page)
        elif st["phase"] == "over":
            page.wait_for_timeout(300)
    return False


def scenario(browser, base, errors):
    """윷 결과를 정해 두고(?force=) 잡기·쉬어 가기·업기·여러 결과·진화를 실제 속도로 일으켜 찍는다.
    팀 0: 파이리(→리자드→리자몽)·이상해씨 / 팀 1: 꼬부기·치코리타 (스타팅), 말 2개, 팀 0 먼저(seed 2)."""
    ctx = browser.new_context(viewport={"width": 1180, "height": 820}, has_touch=True)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
    page.goto(base + "?seed=2&spots=none&force=1,1,2,-1,3,4,4,2")  # 풀숲 없이 (v1 연출만)
    page.wait_for_timeout(400)
    page.click("[data-act=new-family]")
    page.click("[data-act=set][data-field=pieces][data-value='2']")
    page.click("[data-act=to-pick]")
    page.evaluate("() => { window.__yut.Setup.picks[0] = []; }")
    page.click(".pcard[data-id='4']")
    page.click(".pcard[data-id='1']")
    page.click("#pick-next")
    page.click(".pcard[data-id='7']")
    page.click(".pcard[data-id='152']")
    page.click("#pick-next")
    # 🪙 동전 던지기 — 눌러서 던지면 먼저 할 팀 면으로 떨어진다
    page.wait_for_selector(".coin-ov #ct-coin", timeout=10000)
    card = page.inner_text(".coin-ov")
    check("Heads" in card and "Tails" in card, "🪙 시작할 때 동전 던지기 (앞면·뒷면에 두 팀)")
    page.screenshot(path=str(OUT / "00-coin.png"))
    measure(page, "🪙 동전 던지기")
    page.click("#ct-coin", force=True)
    page.wait_for_selector(".coin-ov.landed", timeout=10000)
    first = page.evaluate("() => window.__yut.G.s.turn")
    say = page.inner_text("#ct-say")
    check(("Heads" if first == 0 else "Tails") in say and "first" in say, f"동전이 먼저 할 팀 면으로 ({say})")
    page.screenshot(path=str(OUT / "00-coin-landed.png"))
    wait_idle(page)

    def throw():
        page.wait_for_function("() => { const b = document.querySelector('#btn-throw'); return b && !b.disabled; }", timeout=20000)
        page.click("#btn-throw", force=True)

    def dest(move_id, wait=True):
        sel = f".dest[data-move='{move_id}']"
        page.wait_for_selector(sel, timeout=20000)
        page.click(sel, force=True)
        if wait:
            wait_idle(page)

    throw(); wait_idle(page)
    dest("new/1")                                  # 팀 0: 도 → 1번 칸
    throw(); wait_idle(page)
    dest("new/1", wait=False)                      # 팀 1: 도 → 1번 칸의 팀 0 말과 배틀 → 물리침
    page.wait_for_selector(".battle", timeout=5000)
    t0 = time.time()
    stamp = None
    # 영어판은 대화창 글이 길어 배틀이 약 1.3배 길다 (한국어판 약 10초 → 13초) — 찍는 때도 그만큼 늦춘다
    for name, at in (("50-battle-meet", 2.0), ("50-battle-move", 3.4), ("50-battle-hit", 4.0), ("50-battle-defeat", 6.9), ("50-battle-home", 8.2)):
        page.wait_for_timeout(max(0, int((t0 + at - time.time()) * 1000)))
        page.screenshot(path=str(OUT / f"{name}.png"))
        el = page.query_selector(".bt-stamp:not(.super)")  # '효과가 굉장했다' 도장(.super)은 따로 — 물리친 도장만 본다
        stamp = stamp or (el.inner_text() if el else None)
    if not stamp:
        el = page.wait_for_selector(".bt-stamp:not(.super)", timeout=10000)
        stamp = el.inner_text() if el else None
    check(stamp == "Knocked out!", f"배틀: 기술로 물리침 (도장: {stamp})")
    check(page.query_selector(".bt-ball") is None, "배틀에 몬스터볼이 안 나옴")
    page.wait_for_selector(".battle", state="detached", timeout=15000)
    check(True, f"배틀 길이 약 {time.time() - t0:.1f}초")
    wait_idle(page)
    page.screenshot(path=str(OUT / "51-after-capture.png"))
    check(page.evaluate("() => window.__yut.G.s.turn") == 1, "잡은 팀(1)이 한 번 더 던짐")
    throw(); wait_idle(page)
    page.click(".unit.can")                        # 팀 1: 개 → 판 위 말을 고르고
    dest("n1/2")
    throw()                                        # 팀 0: 빽도 → 판에 말이 없어 쉬어 감
    page.wait_for_timeout(2300)
    page.screenshot(path=str(OUT / "52-skip.png"))
    wait_idle(page)
    check(page.evaluate("() => window.__yut.G.s.turn") == 1, "빽도로 쉬어 가면 차례가 넘어감")
    throw(); wait_idle(page)
    page.click(".pchip.can")                       # 팀 1: 걸 → 새 말을 내서 3번 칸 말 위에 업기
    page.wait_for_timeout(200)
    page.screenshot(path=str(OUT / "53-stack-choice.png"))
    dest("new/3", wait=False)
    page.wait_for_timeout(1300)
    page.screenshot(path=str(OUT / "54-stack.png"))
    wait_idle(page)
    check(page.evaluate("() => window.__yut.Yut.unitsOf(window.__yut.G.s, 1).length") == 1, "업기: 팀 1 말 2개가 한 덩어리")
    throw(); wait_idle(page)                       # 팀 0: 윷 → 한 번 더
    throw(); wait_idle(page)                       # 팀 0: 윷 → 한 번 더
    throw(); wait_idle(page)                       # 팀 0: 개
    page.wait_for_timeout(200)
    page.screenshot(path=str(OUT / "55-many-results.png"))
    dest("new/4")                                  # 새 말 4칸 → 4번 칸
    page.click(".unit.can")
    dest("n4/4", wait=False)                       # 8번 칸 (길의 40%) → 파이리가 리자드로 진화
    page.wait_for_timeout(1500)
    page.screenshot(path=str(OUT / "56-evolving.png"))
    page.wait_for_timeout(1300)
    page.screenshot(path=str(OUT / "57-evolved.png"))
    wait_idle(page)
    form = page.evaluate("() => window.__yut.Yut.formOf(window.__yut.G.s, 0)")
    check(form == 5, f"진화: 파이리 → 리자드 (지금 모습 #{form})")
    page.click(".unit.can[data-node='8']")
    dest("n8/2")                                   # 뒷모(10)에 멈춤
    page.wait_for_timeout(300)
    page.screenshot(path=str(OUT / "58-backmo.png"))
    check(page.evaluate("() => window.__yut.G.s.pieces[0].route") == "B", "뒷모에 멈추면 대각선 길")
    ctx.close()


def scenario_v2(browser, base, errors):
    """v2: ❓ 풀숲 야생 조우 (잡기·놓치기·볼 없음) · 로켓단 쫓아내기 · 보물상자 · 보관함 → 고르기."""
    def ctx_page(vw=1180, vh=820, bag=None):
        ctx = browser.new_context(viewport={"width": vw, "height": vh}, has_touch=True)
        if bag is not None:
            ctx.add_init_script("if (!localStorage.getItem('engmon_yut_en_v1')) localStorage.setItem('engmon_yut_en_v1', " + json.dumps(json.dumps({"bag": bag})) + ");")
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
        return ctx, page

    def start_family(page, query):
        page.goto(base + query)
        page.wait_for_timeout(300)
        page.click("[data-act=new-family]")
        page.click("[data-act=set][data-field=pieces][data-value='2']")
        page.click("[data-act=to-pick]")
        page.click("[data-act=pick-auto]"); page.click("#pick-next")
        page.click("[data-act=pick-auto]"); page.click("#pick-next")
        wait_idle(page)

    store = lambda page, js: page.evaluate("() => { const d = window.__yut.Store.data; return " + js + "; }")

    # ① 잡기 성공 (catch=1) — 가방 몬스터볼 3 → 2, 보관함에 이브이
    ctx, page = ctx_page()
    start_family(page, "?seed=2&force=3&spots=3:58,12:133&catch=1&noslot=1")  # 가디(58)는 가짜 도감에 없음 → NEW!
    check(page.eval_on_selector_all("#spots .spot", "e => e.map(x => +x.dataset.node)") == [3, 12], "윷판에 ❓ 풀숲 2칸 (3번·12번)")
    page.screenshot(path=str(OUT / "70-spots.png"))
    page.click("#btn-throw", force=True); wait_idle(page)
    page.wait_for_selector(".dest[data-move='new/3']")
    check("🌿" in page.inner_text(".dest[data-move='new/3'] b"), "풀숲 칸으로 가는 말풍선에 🌿")
    page.click(".dest[data-move='new/3']", force=True)
    for _ in range(3): answer_quiz(page)                 # 🕐 시계 문제 세 번 먼저
    page.wait_for_selector(".bt-menu .bt-ballbtn", timeout=15000)
    page.screenshot(path=str(OUT / "71-wild-menu.png"))
    check("NEW!" in page.inner_text(".bt-rar"), "처음 보는 포켓몬이면 NEW! (포켓몬 위 희귀도 표시에)")
    page.click(".bt-menu .bt-ballbtn")
    page.wait_for_selector(".bt-stamp", timeout=15000)
    check(page.query_selector(".bt-rar") is None, "잡으면 희귀도 표시는 치우고 '잡았다!'만")
    page.screenshot(path=str(OUT / "72-wild-caught.png"))
    page.wait_for_selector(".bt-menu [data-key='later']", timeout=15000)  # v3: 지금 말로 쓸까요? → 나중에
    page.click(".bt-menu [data-key='later']")
    page.wait_for_selector(".battle", state="detached", timeout=15000)
    wait_idle(page)
    check(store(page, "d.collection.map(x => x.id)") == [58], "잡은 가디가 윷놀이 보관함에")
    check(store(page, "d.bag.poke") == 2, "던진 몬스터볼 1개가 가방에서 빠짐 (3 → 2)")
    check(page.eval_on_selector_all("#spots .spot", "e => e.length") == 1, "쓴 풀숲은 윷판에서 사라짐")
    # 보관함 → 다음 판 고르기
    page.click("[data-act=pause]"); page.click("[data-act=pause-home]")
    page.click("[data-act=new-family]"); page.click("[data-act=to-pick]")
    page.wait_for_timeout(200)
    check("Caught Pokémon" in page.inner_text("#pick-scroll") and page.query_selector(".pcard[data-id='58']") is not None, "고르기 화면 🎯 잡은 포켓몬에 가디가 생김")
    page.screenshot(path=str(OUT / "73-pick-collection.png"))
    page.goto(base + "?fast=1"); page.wait_for_timeout(300)
    page.click("[data-act=profiles]"); page.click("[data-act=prof-bag][data-id=kid]"); page.wait_for_timeout(200)  # 🎒 가방은 👤 프로필 안에
    page.screenshot(path=str(OUT / "74-bag.png"))
    check("Box" in page.inner_text(".modal") and "×2" in page.inner_text(".bag-list"), "가방 창: 볼 개수와 보관함")
    ctx.close()

    # ② 3번 다 놓침 (catch=0) → 도망, 볼 3개 다 씀
    ctx, page = ctx_page()
    start_family(page, "?seed=2&force=3&spots=3:25&catch=0&fast=1&noslot=1")
    page.click("#btn-throw", force=True); wait_idle(page)
    page.click(".dest[data-move='new/3']", force=True)
    for _ in range(3):
        answer_quiz(page, right=False)                   # v4: 🕐 세 문제 다 틀려도 조우는 그대로
    for k in range(3):
        page.wait_for_selector(".bt-menu .bt-ballbtn", timeout=15000)
        page.click(".bt-menu .bt-ballbtn")
    page.wait_for_selector(".battle", state="detached", timeout=20000)
    wait_idle(page)
    check(store(page, "d.bag.poke") == 0 and store(page, "d.collection.length") == 0, "3번 다 놓치면 도망 — 볼 3개 씀, 보관함 그대로")
    ctx.close()

    # ③ 볼이 하나도 없을 때
    ctx, page = ctx_page(bag={"poke": 0, "great": 0, "ultra": 0, "luxury": 0, "master": 0})
    start_family(page, "?seed=2&force=3&spots=3:25&fast=1&noslot=1")
    page.click("#btn-throw", force=True); wait_idle(page)
    page.click(".dest[data-move='new/3']", force=True)
    for _ in range(3): answer_quiz(page)
    page.wait_for_function("() => document.querySelector('.bt-text') && document.querySelector('.bt-text').textContent.includes('No balls')", timeout=15000)
    check(page.query_selector(".bt-menu .bt-ballbtn") is None, "볼이 없으면 안내만 하고 볼 메뉴 없음")
    page.wait_for_selector(".battle", state="detached", timeout=15000)
    ctx.close()

    # ④ 로켓단이 풀숲을 밟으면 쫓아냄
    ctx, page = ctx_page()
    page.goto(base + "?seed=2&force=1,3&spots=3:133&fast=1&catch=0"); page.wait_for_timeout(300)
    page.click("[data-act=new-rocket]"); page.click("[data-act=set][data-field=pieces][data-value='2']")
    page.click("[data-act=to-pick]"); page.click("[data-act=pick-auto]"); page.click("#pick-next")
    page.wait_for_selector("#ri-go"); page.click("#ri-go"); wait_idle(page)
    page.click("#btn-throw", force=True); wait_idle(page)
    page.click(".dest[data-move='new/1']", force=True)
    page.wait_for_function("() => { const s = window.__yut.G.s; return s.spots[0].used; }", timeout=20000)
    page.wait_for_timeout(600)
    check(page.query_selector(".battle") is None and store(page, "d.collection.length") == 0, "로켓단이 풀숲에 멈추면 그물 (조우 화면 없음, 내 보관함 그대로)")
    ctx.close()

    # ⑤ 로켓단을 이기면 보물상자 — 가방에 볼이 들어가고, 새로고침해도 두 번 안 들어감
    ctx, page = ctx_page()
    page.goto(base + "?seed=2&fast=1&box=master,luxury,poke&noslot=1"); page.wait_for_timeout(300)
    page.click("[data-act=new-rocket]"); page.click("[data-act=set][data-field=pieces][data-value='2']")
    page.click("[data-act=to-pick]"); page.click("[data-act=pick-auto]"); page.click("#pick-next")
    page.wait_for_selector("#ri-go"); page.click("#ri-go"); wait_idle(page)
    page.evaluate("""() => { const Y = window.__yut, s = Y.G.s;
      Object.assign(s.pieces[0], { state: "done" });
      Object.assign(s.pieces[1], { state: "board", route: "OUT", step: 19, atGoal: false });
      s.phase = "choose"; s.pending = [3]; s.throwsLeft = 0; s.turn = 0;
      Y.Store.data.game = s; Y.Store.save(); }""")
    page.goto(base + "?fast=1&box=master,luxury,poke&noslot=1"); page.wait_for_timeout(300)
    page.click("[data-act=resume]"); wait_idle(page)
    page.click(".dest.goal", force=True)  # 둘 수 있는 말이 하나라 이미 골라져 있다
    page.wait_for_selector(".win-screen .chest", timeout=20000)
    check(store(page, "[d.bag.master, d.bag.luxury, d.bag.poke]") == [1, 1, 4], "이긴 순간 상자 볼이 가방에 (마스터 1 · 럭셔리 1 · 몬스터 3+1)")
    check(page.query_selector(".win-btns.hidden") is not None, "상자를 열기 전에는 '한 판 더' 버튼이 숨어 있음")
    page.screenshot(path=str(OUT / "75-box-closed.png"))
    page.click(".win-screen .chest", force=True)  # 통통 튀는 중이라 강제로
    page.wait_for_function("() => document.querySelectorAll('#box-balls .ballchip').length === 3", timeout=15000)
    check(page.query_selector(".win-btns.hidden") is not None, "상자 뒤 💰 돈 문제를 풀기 전에는 버튼이 숨어 있음")
    col0 = store(page, "d.collection.length")
    page.wait_for_selector(".quiz .qz-scene .cs-mon", timeout=15000)
    check("Pokémon Center" in page.inner_text(".quiz .qz-title") and "customer" in page.inner_text(".quiz .cs-say"), "🏥 돈 문제 = 포켓몬센터에서 럭키의 계산 돕기 (계산대 그림 · 럭키 · 말풍선)")
    page.screenshot(path=str(OUT / "76a-center-quiz.png"))
    titles = []
    for k in range(3):
        page.wait_for_selector(".quiz .qz-choice:not([disabled])", timeout=20000)
        titles.append(page.inner_text(".quiz .qz-title"))
        answer_quiz(page, timeout=20000)
    check(all(f"{k + 1}/3" in t for k, t in enumerate(titles)) and "Unique 10%" in titles[0] and "Unique 13%" in titles[1] and "Unique 16%" in titles[2],
          "🏥 손님 세 명 (1/3 · 2/3 · 3/3), 맞힐 때마다 유니크 10 → 13 → 16%")
    check("up to 1,000 won" in titles[0] and "+3%" in titles[0] and "up to 1,000 won" in titles[1] and "+3%" in titles[1] and "up to 10,000 won" in titles[2] and "+4%" in titles[2],
          "🏥 단계: ① 천 원 +3% · ② 천 원 +3% · ③ 만 원 +4%")
    page.wait_for_selector(".center-ov .cv-ball", timeout=15000)
    check(store(page, "JSON.stringify(d.lastGame.reward.bonus.odds)") == '{"c":40,"r":20,"u":20,"l":20}' and "20%" in page.inner_text(".center-ov"),
          "세 문제 다 맞히면 볼 속 확률 일반 40 · 레어 20 · 유니크 20 · 전설 20")
    check("Poké Ball" in page.inner_text(".center-ov") and store(page, "d.lastGame.reward.bonus.opened") is False, "끝나면 🏥 포켓몬센터 화면에서 럭키가 몬스터볼을 줌 (아직 안 열림)")
    vis = page.evaluate("() => { const b = document.querySelector('.center-ov .cv-ball').getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight; }")
    check(vis, "몬스터볼이 스크롤 없이 바로 보임 (상자 · 볼 목록은 뒤에 가려짐)")
    page.screenshot(path=str(OUT / "76b-center-ball.png"))
    page.click(".center-ov .cv-ball", force=True)
    page.wait_for_selector(".center-ov .cv-mon", timeout=15000)
    check("Ta-da" in page.inner_text(".center-ov"), "포켓몬센터 화면에서 볼을 열면 짜잔!")
    page.click("[data-act=center-close]")
    page.wait_for_selector("#bonus-zone .bonus-mon", timeout=15000)
    page.wait_for_selector(".win-btns:not(.hidden)", timeout=5000)
    mon = store(page, "d.lastGame.reward.bonus.mon")
    check(mon and "Ta-da" in page.inner_text("#bonus-zone") and store(page, f"d.collection.some(x => x.id === {mon})"), f"몬스터볼을 열면 짜잔! 포켓몬이 나옴 ({mon}) · 보관함에")
    page.screenshot(path=str(OUT / "76-box-open.png"))
    col1 = store(page, "d.collection.length")
    page.reload(); page.wait_for_timeout(400)
    check(sum(store(page, "Object.values(d.bag)")) == 6 and store(page, "d.collection.length") == col1, "새로고침해도 상자 볼 · 돈 문제 포켓몬이 두 번 안 들어감 (볼 3 + 3)")
    ctx.close()

    # ⑥ 설정에서 "배틀 장면 건너뛰기" — 배틀 화면 없이 물리치고, 진 말은 집으로, 이긴 팀은 한 번 더
    ctx, page = ctx_page()
    page.goto(base + "?seed=2&spots=none&force=1,1"); page.wait_for_timeout(300)
    page.click("[data-act=new-family]")
    page.click("[data-act=set][data-field=pieces][data-value='2']")
    page.click("[data-act=set][data-field=battle][data-value='false']")
    page.screenshot(path=str(OUT / "77-setup-battle-skip.png"))
    page.click("[data-act=to-pick]")
    page.click("[data-act=pick-auto]"); page.click("#pick-next")
    page.click("[data-act=pick-auto]"); page.click("#pick-next")
    wait_idle(page)
    check(page.evaluate("() => window.__yut.G.s.settings.battle") is False and store(page, "d.settings.battle") is False, "건너뛰기 설정이 판과 저장에 들어감")
    page.click("#btn-throw", force=True); wait_idle(page)
    page.click(".dest[data-move='new/1']", force=True); wait_idle(page)
    page.click("#btn-throw", force=True); wait_idle(page)
    page.click(".dest[data-move='new/1']", force=True)    # 팀 1 이 팀 0 말을 잡음
    saw_battle = False
    t0 = time.time()
    while time.time() - t0 < 2.5:
        saw_battle = saw_battle or page.query_selector(".battle") is not None
        page.wait_for_timeout(100)
    wait_idle(page)
    hint_txt = page.inner_text("#hint")
    page.screenshot(path=str(OUT / "78-battle-skipped.png"))
    st = page.evaluate("() => { const s = window.__yut.G.s; return [s.turn, s.phase, s.pieces[0].state]; }")
    check(not saw_battle, "배틀 화면이 안 뜸")
    check(st == [1, "throw", "wait"], f"진 말은 대기로, 이긴 팀이 한 번 더 던짐 ({st})")
    ctx.close()


def scenario_v3(browser, base, errors):
    """v3: ✨ 기술 (배우기·쓰기·대상 고르기·저절로 기술) · 🔄 잡은 포켓몬으로 말 바꾸기 · 😼 로켓단 그물 · 기술 끄기 · 기술 도감."""
    def ctx_page(vw=1180, vh=820):
        ctx = browser.new_context(viewport={"width": vw, "height": vh}, has_touch=True)
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
        page.on("console", lambda m: errors.append("console: " + m.text) if m.type == "error" else None)
        return ctx, page

    def start(page, query, mode="family", pieces=4, skills=True):
        page.goto(base + query + ("" if "luck=" in query else "&luck=1"))
        page.wait_for_timeout(300)
        page.click("[data-act=new-family]" if mode == "family" else "[data-act=new-rocket]")
        page.click(f"[data-act=set][data-field=pieces][data-value='{pieces}']")
        if not skills:
            page.click("[data-act=set][data-field=skills][data-value='false']")
        page.click("[data-act=to-pick]")
        page.click("[data-act=pick-auto]"); page.click("#pick-next")
        if mode == "family":
            page.click("[data-act=pick-auto]"); page.click("#pick-next")
        else:
            page.wait_for_selector("#ri-go"); page.click("#ri-go")
        wait_idle(page)

    # 판 상태를 바로 만든다: at(i, 칸) = 말 i 를 그 칸에 (바깥길로 온 것으로)
    def inject(page, js):
        page.evaluate("""() => { const Y = window.__yut, G = Y.G, s = G.s;
          const at = (i, n, walk) => Object.assign(s.pieces[i], { state: 'board', atGoal: false, walk: walk || 0 }, Y.Yut.settle('OUT', n));
          const fresh = (team, phase, pending) => { s.turn = team; s.turnNo += 2; s.phase = phase || 'throw'; s.throwsLeft = phase === 'choose' ? 0 : 1; s.pending = pending || []; };
          """ + js + """;
          Y.Act['skill-cancel'](); }""")
        wait_idle(page)

    ev = lambda page, js: page.evaluate("() => { const Y = window.__yut, G = Y.G, s = G.s; return " + js + "; }")

    def use_skill(page, key):
        page.wait_for_selector("#btn-skill:not([hidden])", timeout=10000)
        page.click("#btn-skill")
        page.wait_for_selector(".skill-item[data-act=skill-pick]", timeout=5000)
        items = page.query_selector_all(".skill-item[data-act=skill-pick]")
        name = ev(page, f"Y.Yut.SKILLS['{key}'].name")
        pick = next((it for it in items if name in it.inner_text()), None)
        check(pick is not None, f"기술 창에 {name}")
        if pick:
            pick.click()

    # ① 설정: 두 대결 모두 ✨ 기술 켜기/끄기 (처음 게임 설정)
    ctx, page = ctx_page()
    for mode in ("family", "rocket"):
        page.goto(base + "?fast=1"); page.wait_for_timeout(250)
        page.click("[data-act=new-" + mode + "]")
        on = page.query_selector("[data-act=set][data-field=skills][data-value='true'].on")
        off = page.query_selector("[data-act=set][data-field=skills][data-value='false']")
        check(on is not None and off is not None, f"{mode} 준비 화면에 ✨ 기술 켜기/끄기 (처음엔 켜짐)")
    page.screenshot(path=str(OUT / "80-setup-skills.png"), full_page=True)
    ctx.close()

    # ② 기술 끄기 — 전설(early)이어도 안 배우고, 기술 버튼이 없다
    ctx, page = ctx_page()
    start(page, "?seed=2&spots=none&early=1&fast=1", skills=False)
    check(ev(page, "[s.settings.skills, Y.Store.data.settings.skills, s.pieces.every(p => !p.skill)]") == [False, False, True], "기술 끄기: 판·저장에 들어가고 아무도 기술을 안 배움")
    inject(page, "at(0, 3)")
    check(page.query_selector("#btn-skill:not([hidden])") is None, "기술 끄기: ✨ 기술 버튼 없음")
    ctx.close()

    # ③ 기술 쓰기 — 니트로차지(바로) · 파도타기(상대 말 고르기) · 희망사항(결과 고르기) · 스텔스록(빈 칸 고르기)
    ctx, page = ctx_page()
    start(page, "?seed=2&spots=none&early=1&pools=nitro,surf,wish,rock|iron,moon,bond,counter&fast=1")
    check(ev(page, "s.pieces.map(p => p.skill).join(',')") == "nitro,surf,wish,rock,iron,moon,bond,counter", "전설(early): 판을 시작할 때 기술을 배움")
    inject(page, "at(0, 3)")
    page.screenshot(path=str(OUT / "81-skill-button.png"))
    measure(page, "✨ 기술 버튼이 있는 윷판")
    use_skill(page, "nitro")
    page.wait_for_selector(".cutin", timeout=5000)
    page.screenshot(path=str(OUT / "82-cutin.png"))
    wait_idle(page)
    check(ev(page, "[Y.Yut.posOf(s.pieces[0]), s.pieces[0].used]") == [5, True], "니트로차지: 바로 2칸 (3 → 5), 한 번 쓰면 끝")
    check(page.query_selector("#btn-skill:not([hidden])") is None, "한 차례에 기술 하나 — 버튼이 사라짐")
    check(page.query_selector(".pchip[data-piece='0'] .sk.used") is not None, "다 쓴 말 칩에 ✓")
    # 파도타기: 반짝이는 상대 말을 누른다
    inject(page, "fresh(0); at(1, 12); at(5, 9)")
    use_skill(page, "surf")
    page.wait_for_selector("#dests .dest.skill-t", timeout=5000)
    rings = ev(page, "[...document.querySelectorAll('#dests .dest.skill-t')].map(d => +d.dataset.node)")
    check(rings == [9], f"파도타기: 밀 수 있는 상대 말만 반짝 ({rings})")
    check(page.inner_text("#btn-skill") == "✖ Cancel", "대상 고르는 중엔 ✖ 취소 버튼")
    page.screenshot(path=str(OUT / "83-target.png"))
    measure(page, "기술 대상 고르기")
    page.click("#dests .dest.skill-t", force=True)
    wait_idle(page)
    check(ev(page, "Y.Yut.posOf(s.pieces[5])") == 7, "파도타기: 상대 말이 2칸 뒤로 (9 → 7)")
    # 희망사항: 결과 고르기 창
    inject(page, "fresh(0); at(2, 6)")
    use_skill(page, "wish")
    page.wait_for_selector(".res-pick .btn", timeout=5000)
    page.screenshot(path=str(OUT / "84-wish.png"))
    measure(page, "희망사항 결과 고르기")
    page.click(".res-pick .btn[data-v='5']")
    wait_idle(page)
    check(ev(page, "[s.phase, s.pending.join(','), s.throwsLeft]") == ["choose", "5", 0], "희망사항: 모를 골라도 한 번 더 없음")
    # 스텔스록: 빈 칸 고르기 → 윷판에 🪨
    inject(page, "fresh(0); at(3, 2)")
    use_skill(page, "rock")
    page.wait_for_selector("#dests .dest.skill-t[data-node='10']", timeout=5000)
    page.click("#dests .dest.skill-t[data-node='10']", force=True)
    wait_idle(page)
    check(ev(page, "JSON.stringify(s.traps)") == '[{"node":10,"kind":"rock","team":0}]' and page.query_selector("#traps .trap[data-node='10']") is not None, "스텔스록: 10번 칸에 바위")
    page.screenshot(path=str(OUT / "85-rock.png"))
    # 저절로 기술: 🛡️ 철벽(튕겨 냄) · 🌙 달빛(한 칸 뒤로) · 👻 길동무(잡은 말도 집으로)
    inject(page, "fresh(0, 'choose', [3]); s.traps = []; [0,1,2,3,5,6,7].forEach(i => { if (i < 4) s.pieces[i].state = 'wait'; }); at(0, 4); at(4, 7)")
    page.click(".unit.can[data-node='4']", force=True)
    page.click(".dest[data-move='n4/3']", force=True)
    page.wait_for_selector(".cutin", timeout=8000)
    page.screenshot(path=str(OUT / "86-iron.png"))
    wait_idle(page)
    check(ev(page, "[Y.Yut.posOf(s.pieces[0]), s.pieces[4].state, s.pieces[4].used]") == [4, "board", True], "철벽: 잡으러 간 말이 제자리로 튕겨 나감")
    inject(page, "fresh(0, 'choose', [3]); s.pieces[4].state = 'wait'; at(0, 4); at(5, 7)")
    page.click(".unit.can[data-node='4']", force=True)
    page.click(".dest[data-move='n4/3']", force=True)
    wait_idle_or_popup(page)
    page.wait_for_function("() => !window.__yut.G.busy || document.querySelector('.bt-skip')", timeout=20000)
    while page.query_selector(".bt-skip"):
        page.click(".bt-skip", force=True); page.wait_for_timeout(200)
    wait_idle(page)
    check(ev(page, "[Y.Yut.posOf(s.pieces[5]), s.pieces[5].used]") == [6, True], "달빛: 잡혀도 집 대신 한 칸 뒤로 (7 → 6)")
    inject(page, "fresh(0, 'choose', [3]); s.pieces[5].state = 'wait'; at(0, 4); at(6, 7)")
    page.click(".unit.can[data-node='4']", force=True)
    page.click(".dest[data-move='n4/3']", force=True)
    page.wait_for_function("() => !window.__yut.G.busy || document.querySelector('.bt-skip')", timeout=20000)
    while page.query_selector(".bt-skip"):
        page.click(".bt-skip", force=True); page.wait_for_timeout(200)
    wait_idle(page)
    check(ev(page, "[s.pieces[6].state, s.pieces[0].state]") == ["wait", "wait"], "길동무: 잡힌 말과 잡은 말이 모두 집으로")
    # 🥊 카운터: 파도타기를 되돌림
    inject(page, "fresh(0); s.pieces[1].used = false; at(1, 12); at(5, 9); at(7, 15)")
    use_skill(page, "surf")
    page.wait_for_selector("#dests .dest.skill-t[data-node='9']", timeout=5000)
    page.click("#dests .dest.skill-t[data-node='9']", force=True)
    wait_idle(page)
    check(ev(page, "[Y.Yut.posOf(s.pieces[5]), Y.Yut.posOf(s.pieces[1]), s.pieces[7].used]") == [9, 10, True], "카운터: 상대는 그대로, 파도타기를 쓴 말이 2칸 밀림")
    ctx.close()

    # ④ 5칸마다 진화 → 마지막 모습에서 기술을 배움 (배우는 알림)
    ctx, page = ctx_page()
    start(page, "?seed=2&spots=none&pools=nitro,nitro,nitro,nitro&fast=1")
    inject(page, "fresh(0, 'choose', [1]); Object.assign(s.pieces[0], { stage: 1 }); at(0, 9, 9)")
    page.click(".unit.can[data-node='9']", force=True)
    page.click(".dest[data-move='n9/1']", force=True)
    page.wait_for_function("() => document.querySelector('#hint').textContent.includes('learned')", timeout=15000)
    page.screenshot(path=str(OUT / "87-learn.png"))
    wait_idle(page)
    check(ev(page, "[s.pieces[0].stage, s.pieces[0].skill]") == [2, "nitro"], "10칸 → 마지막 모습 + 기술 배움")
    check(page.query_selector(".pchip[data-piece='0'] .sk") is not None, "배운 기술이 팀 카드 칩 모서리에")
    ctx.close()

    # ⑤ 🔄 잡은 포켓몬으로 바로 말 바꾸기 (가족 대결)
    ctx, page = ctx_page()
    start(page, "?seed=2&force=3&spots=3:133&catch=1&fast=1&swappool=splash")
    page.click("#btn-throw", force=True); wait_idle(page)
    page.click(".dest[data-move='new/3']", force=True)
    for _ in range(3): answer_quiz(page)                 # 🕐 시계 문제 세 번 먼저
    page.wait_for_selector(".bt-menu .bt-ballbtn", timeout=15000)
    page.click(".bt-menu .bt-ballbtn")
    page.wait_for_selector(".bt-menu .bt-swapbtn", timeout=15000)
    page.screenshot(path=str(OUT / "88-swap-menu.png"))
    n_opts = len(page.query_selector_all(".bt-menu .bt-swapbtn"))
    check(n_opts >= 1, f"잡으면 '지금 말로 쓸까요?' — 바꿀 말 {n_opts}개")
    moved = ev(page, "s.pieces.findIndex((p, i) => p.team === 0 && p.state === 'board')")
    page.click(f".bt-menu .bt-swapbtn[data-key='{moved}']")
    page.wait_for_selector(".battle", state="detached", timeout=20000)
    wait_idle(page)
    check(ev(page, f"[Y.Yut.formOf(s, {moved}), s.teams[0].picks.indexOf(133) >= 0, Y.Yut.posOf(s.pieces[{moved}])]") == [133, True, 3], "풀숲에 선 말이 그 자리에서 이브이로 바뀜")
    check(ev(page, "Y.Store.data.collection.map(x => x.id).join(',')") == "133", "잡은 포켓몬은 보관함에도")
    page.screenshot(path=str(OUT / "89-swapped.png"))
    ctx.close()
    # 나중에 → 말은 그대로
    ctx, page = ctx_page()
    start(page, "?seed=2&force=3&spots=3:133&catch=1&fast=1")
    page.click("#btn-throw", force=True); wait_idle(page)
    page.click(".dest[data-move='new/3']", force=True)
    for _ in range(3): answer_quiz(page)                 # 🕐 시계 문제 세 번 먼저
    page.wait_for_selector(".bt-menu .bt-ballbtn", timeout=15000)
    page.click(".bt-menu .bt-ballbtn")
    page.wait_for_selector(".bt-menu [data-key='later']", timeout=15000)
    page.click(".bt-menu [data-key='later']")
    page.wait_for_selector(".battle", state="detached", timeout=20000)
    wait_idle(page)
    check(ev(page, "s.teams[0].picks.indexOf(133) < 0 && Y.Store.data.collection.length === 1"), "나중에: 말은 그대로, 보관함에만")
    ctx.close()

    # ⑥ 😼 로켓단도 풀숲에서 그물로 잡아 자기 말로 (catch=1) · 그물이 찢어지면 도망 (catch=0)
    for catch, want in (("1", True), ("0", False)):
        ctx, page = ctx_page(820, 1180)
        start(page, f"?seed=2&force=1,3&spots=3:133&catch={catch}&fast=1", mode="rocket", pieces=2)
        page.click("#btn-throw", force=True); wait_idle(page)
        page.click(".dest[data-move='new/1']", force=True)
        page.wait_for_function("() => window.__yut.G.s.spots[0].used", timeout=20000)
        page.wait_for_function("() => !window.__yut.G.busy && !window.__yut.G.swapAfter", timeout=20000)
        page.wait_for_timeout(400)
        got = ev(page, "s.teams[1].picks.indexOf(133) >= 0")
        check(got == want and ev(page, "Y.Store.data.collection.length") == 0 and page.query_selector(".battle") is None,
              "로켓단 그물: " + ("잡아서 로켓단 말이 이브이로 (내 보관함엔 없음)" if want else "찢어지면 도망, 로켓단 말 그대로"))
        if want:
            page.screenshot(path=str(OUT / "90-rocket-net.png"))
        ctx.close()

    # ⑦ 기술 도감 (처음 화면)
    ctx, page = ctx_page(390, 844)
    page.goto(base + "?fast=1"); page.wait_for_timeout(300)
    page.click("[data-act=help]"); page.wait_for_timeout(200)
    check(page.query_selector(".help-tabs [data-tab=rules].on") is not None and "How to play" in page.inner_text(".modal h2"), "📖 방법 · 도감 한 창 (처음엔 방법)")
    page.click("[data-act=help-tab][data-tab=dex]"); page.wait_for_timeout(200)
    check(len(page.query_selector_all(".dex-card")) == 36, "기술 도감: 36개 (타입마다 2개)")
    check(len(page.query_selector_all(".tchart .tc-row")) == 18 and "Strong" in page.inner_text(".tchart"), "기술 도감 아래 ⚔️ 타입 상성표 (18타입)")
    page.evaluate("() => document.querySelector('.tchart').scrollIntoView()")
    page.screenshot(path=str(OUT / "91b-typechart.png"))
    page.screenshot(path=str(OUT / "91-skilldex.png"))
    measure(page, "기술 도감 (폰)")
    ctx.close()


def scenario_v4(browser, base, errors):
    """v4: 🕐 시계 문제 · 💰 돈 문제 · 🎓 공부 끄기 · ✨ 15칸 기술."""
    def ctx_page(vw=1180, vh=820):
        ctx = browser.new_context(viewport={"width": vw, "height": vh}, has_touch=True)
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
        page.on("console", lambda m: errors.append("console: " + m.text) if m.type == "error" else None)
        # 풀숲 포켓몬을 뽑을 때 쓴 확률을 적어 둔다
        page.add_init_script("""window.__odds = []; window.addEventListener('load', () => {
          const R = Yut.Rewards, o = R.rollWild; R.rollWild = function (p, own, rnd, odds) { window.__odds.push(odds ? odds.l : 10); return o.apply(this, arguments); }; });""")
        return ctx, page

    def start(page, query, mode="family", study=True):
        page.goto(base + query + ("" if "luck=" in query else "&luck=1"))
        page.wait_for_timeout(300)
        page.click("[data-act=new-family]" if mode == "family" else "[data-act=new-rocket]")
        page.click("[data-act=set][data-field=pieces][data-value='2']")
        if not study:
            page.click("[data-act=set][data-field=study][data-value='false']")
        page.click("[data-act=to-pick]")
        page.click("[data-act=pick-auto]"); page.click("#pick-next")
        if mode == "family":
            page.click("[data-act=pick-auto]"); page.click("#pick-next")
        else:
            page.wait_for_selector("#ri-go"); page.click("#ri-go")
        wait_idle(page)

    ev = lambda page, js: page.evaluate("() => { const Y = window.__yut, G = Y.G, s = G.s, d = Y.Store.data; return " + js + "; }")

    def to_spot(page):
        page.evaluate("() => { window.__yut.G.s.spots = [{ node: 3, id: null, used: false }]; }")  # 포켓몬은 아직 안 뽑힌 풀숲
        page.click("#btn-throw", force=True); wait_idle(page)
        page.click(".dest[data-move='new/3']", force=True)

    # ① 준비 화면: 두 대결 모두 🎓 공부 문제 켜기/끄기 (처음엔 켜짐)
    ctx, page = ctx_page()
    for mode in ("family", "rocket"):
        page.goto(base + "?fast=1"); page.wait_for_timeout(250)
        page.click("[data-act=new-" + mode + "]")
        check(page.query_selector("[data-act=set][data-field=study][data-value='true'].on") is not None, f"{mode} 준비 화면에 🎓 공부 문제 켜기/끄기 (처음엔 켜짐)")
    ctx.close()

    # ② 🕐 시계 세 번 다 맞힘: ① → ② 15·30·45분 → ③ 몇 시 몇 분, 전설 10 → 20% · 공부 기록
    ctx, page = ctx_page()
    start(page, "?seed=2&force=3&fast=1&catch=0&clock=3:40")
    to_spot(page)
    page.wait_for_selector(".quiz .clock", timeout=15000)
    page.wait_for_timeout(500)  # 튀어나오는 연출이 끝난 뒤에 잰다
    labels = page.eval_on_selector_all(".qz-choice", "e => e.map(x => x.textContent).sort()")
    check(labels == ["3:08", "3:40", "4:40", "8:15"], f"시계 보기 4개 = 정답 + 아이가 하는 실수 ({labels})")
    measure(page, "🕐 시계 문제")
    page.screenshot(path=str(OUT / "93-clock.png"))
    t1 = page.inner_text(".quiz .qz-title")
    answer_quiz(page)
    page.wait_for_selector(".quiz .qz-choice:not([disabled])", timeout=15000)
    t2, a2 = page.inner_text(".quiz .qz-title"), page.inner_text(".quiz .qz-choice[data-ok]")
    answer_quiz(page)
    page.wait_for_selector(".quiz .qz-choice:not([disabled])", timeout=15000)
    t3, a3 = page.inner_text(".quiz .qz-title"), page.inner_text(".quiz .qz-choice[data-ok]")
    answer_quiz(page)
    m2 = int(re.search(r":(\d+)", a2).group(1)); m3 = int(re.search(r":(\d+)", a3).group(1))
    check("1/3" in t1 and "2/3" in t2 and ":15 · :30 · :45" in t2 and m2 in (15, 30, 45) and "3/3" in t3 and "minute by minute" in t3 and m3 % 5 != 0,
          f"🕐 맞히면 다음 단계: ② 15·30·45분 ({a2}) → ③ 1분 단위 ({a3})")
    check("Unique 10%" in t1 and "Unique 13%" in t2 and "Unique 16%" in t3, "맞힐 때마다 유니크·전설 10 → 13 → 16%")
    page.wait_for_selector(".bt-menu .bt-ballbtn", timeout=15000)
    check(ev(page, "window.__odds.slice(-1)[0]") == 20 and ev(page, "s.spots[0].id > 0"), "세 번 다 맞히면 전설 20%로 뽑고, 뽑은 포켓몬은 판에 저장")
    check(ev(page, "[d.study.clock.right, d.study.clock.total]") == [3, 3], "공부 기록: 시계 3/3")
    ctx.close()

    # ③ 사용자 예: ① 틀림 → ① 다른 문제 맞힘(+3) → ② 틀림 = +3%만 (전설 13%)
    ctx, page = ctx_page(960, 600)
    start(page, "?seed=2&force=3&fast=1&catch=0&clock=7:25")
    to_spot(page)
    page.wait_for_selector(".quiz .qz-choice", timeout=15000)
    page.click(".quiz .qz-choice:not([data-ok])")
    page.wait_for_selector(".quiz .qz-next:not([hidden])", timeout=15000)
    exp = page.inner_text(".qz-explain")
    check("7" in exp and "25 minutes" in exp and "It's 7:25" in exp, "틀리면 풀이: 짧은 바늘 → 몇 시, 긴 바늘 → 몇 분")
    measure(page, "🕐 시계 풀이 (낮은 가로 화면)")
    page.screenshot(path=str(OUT / "94-clock-explain.png"))
    page.click(".quiz .qz-next")
    page.wait_for_selector(".quiz .qz-choice:not([disabled])", timeout=15000)
    t2, a2 = page.inner_text(".quiz .qz-title"), page.inner_text(".quiz .qz-choice[data-ok]")
    check("2/3" in t2 and "o'clock" in t2 and "o'clock" in a2 and ":" not in a2, f"① 틀리면 같은 ① 단계의 다른 문제 (정각 {a2})")
    answer_quiz(page)
    page.wait_for_selector(".quiz .qz-choice:not([disabled])", timeout=15000)
    t3 = page.inner_text(".quiz .qz-title")
    check("3/3" in t3 and ":15 · :30 · :45" in t3, "① 맞히면 마지막 기회는 ② 단계")
    answer_quiz(page, right=False)
    page.wait_for_selector(".bt-menu .bt-ballbtn", timeout=15000)
    check(ev(page, "window.__odds.slice(-1)[0]") == 13 and ev(page, "[d.study.clock.right, d.study.clock.total]") == [1, 3],
          "① 틀림 · ① 맞힘 · ② 틀림 → +3%만 (전설 13%), 공부 기록 1/3")
    ctx.close()

    # ⑦ ✨ 10칸 규칙 (v8: 모두 10칸) — 칩에 남은 칸 표시
    ctx, page = ctx_page()
    start(page, "?seed=2&spots=none&fast=1&pools=wish,nitro")
    check(ev(page, "s.teams.every(t => t.need.length > 0 && t.need.every(n => n === 10))"), "모든 말이 10칸에 기술")
    page.evaluate("""() => { const Y = window.__yut, s = Y.G.s, t = s.teams[0];
      t.picks[0] = 128; t.paths[0] = [128]; t.pools[0] = ['wish']; s.pieces[0].stage = 0;
      Object.assign(s.pieces[0], { state: 'board', atGoal: false, walk: 7 }, Y.Yut.settle('OUT', 12)); s.turn = 0; s.phase = 'choose'; s.pending = [3]; s.throwsLeft = 0; Y.Act['skill-cancel'](); }""")
    wait_idle(page)
    check(page.query_selector(".pchip[data-piece='0'] .sk.left") is not None and ev(page, "s.pieces[0].skill") is None, "켄타로스 7칸: 아직 기술 없음, 칩에 남은 칸")
    page.click(".unit.can[data-node='12']", force=True)
    page.click(".dest[data-move='n12/3']", force=True)
    wait_idle(page)
    check(ev(page, "s.pieces[0].skill") == "wish", "10칸이 되면 기술을 배움")
    ctx.close()

    # ⑫ 💀 어려움: 준비 화면 칩 · 이기면 볼 4개 특별 상자
    ctx, page = ctx_page()
    page.goto(base + "?seed=2&fast=1&spots=none"); page.wait_for_timeout(300)
    page.click("[data-act=new-rocket]")
    page.click("[data-act=set][data-field=cpu][data-value='\"hard\"']")
    check("4 balls" in page.inner_text(".card"), "로켓단 세기에 💀 어려움 (이기면 볼 4개 안내)")
    page.click("[data-act=set][data-field=pieces][data-value='2']")
    page.click("[data-act=set][data-field=study][data-value='false']")
    page.click("[data-act=to-pick]"); page.click("[data-act=pick-auto]"); page.click("#pick-next")
    page.wait_for_selector("#ri-go"); check("No going easy" in page.inner_text(".rocket-intro"), "어려움 등장 대사"); page.click("#ri-go"); wait_idle(page)
    check(ev(page, "s.settings.cpuLevel") == "hard", "판에 어려움이 들어감")
    page.evaluate("""() => { const Y = window.__yut, s = Y.G.s; Object.assign(s.pieces[0], { state: 'done' });
      Object.assign(s.pieces[1], { state: 'board', route: 'OUT', step: 19, atGoal: false }); s.phase = 'choose'; s.pending = [3]; s.throwsLeft = 0; s.turn = 0; Y.Act['skill-cancel'](); }""")
    wait_idle(page)
    page.click(".dest.goal", force=True)
    page.wait_for_selector(".win-screen .chest", timeout=20000)
    check(ev(page, "d.lastGame.reward.balls.length") == 4 and "special chest" in page.inner_text(".win-screen"), "어려움을 이기면 볼 4개 특별 상자")
    page.click(".win-screen .chest", force=True)
    page.wait_for_function("() => document.querySelectorAll('#box-balls .ballchip').length === 4", timeout=15000)
    page.wait_for_selector(".win-btns:not(.hidden)", timeout=15000)
    page.screenshot(path=str(OUT / "99f-hard-box.png"))
    ctx.close()

    # ⑬ v6: 🎰 슬롯머신 · 😈 로켓단 무작위 · 진화형부터 · 💡 잡기 힌트 · 🎲 확률 막대 · 💧🔥 상성 · 🔤 영어
    ctx, page = ctx_page()
    page.add_init_script("if (!localStorage.getItem('engmon_yut_en_v1')) localStorage.setItem('engmon_yut_en_v1', JSON.stringify({ collection: [{ id: 5, t: 1 }], bag: { poke: 3, great: 0, ultra: 0, luxury: 0, master: 0 } }));")
    page.goto(base + "?seed=2&spots=none&fast=1&force=2"); page.wait_for_timeout(300)
    page.click("[data-act=new-family]"); page.click("[data-act=set][data-field=pieces][data-value='2']")
    page.click("[data-act=set][data-field=study][data-value='false']")
    page.click("[data-act=to-pick]")
    page.evaluate("() => { window.__yut.Setup.picks[0] = []; }")
    page.click(".pcard[data-id='5']")
    minis = len(page.query_selector_all(".slot.filled .evo .mini"))
    check(minis == 2, f"리자드를 고르면 진화 미리보기가 리자드 › 리자몽 ({minis}칸)")
    page.click(".pcard[data-id='1']"); page.click("#pick-next"); page.click("[data-act=pick-auto]"); page.click("#pick-next")
    wait_idle(page)
    check(page.query_selector(".gacha-ov") is None and ev(page, "d.bag.great") == 0, "가족 대결에는 캡슐 뽑기 없음, 지온이 가방도 그대로")
    check(ev(page, "[window.__yut.Yut.formOf(s, 0), s.pieces[0].base]") == [5, 1], "잡은 리자드는 리자드부터 출발")
    page.reload(); page.wait_for_timeout(400); page.click("[data-act=resume]"); wait_idle(page)
    check(page.query_selector(".gacha-ov") is None, "이어하기에서는 캡슐 뽑기가 다시 안 나옴")
    # 🔤 영어판 단어 세트: 개 = 그 판 세트의 두 번째 단어 (예: 🐶 dog), 아래 줄에 "Gae · 2 spaces"
    page.click("#btn-throw", force=True)
    page.wait_for_selector(".result-pop .result-word", timeout=10000)
    want = page.evaluate("() => yutWord(2).word")
    check(page.inner_text(".result-pop .result-word .rw") == want and "Gae" in page.inner_text(".result-pop .result-sub"),
          f"윷 결과 카드에 그 판의 단어 (개 = {want}) + 'Gae · 2 spaces'")
    wait_idle(page)
    # 💡 잡을 수 있었는데 다른 수
    page.evaluate("""() => { const Y = window.__yut, s = Y.G.s, at = (i, n) => Object.assign(s.pieces[i], { state: 'board', atGoal: false }, Y.Yut.settle('OUT', n));
      s.pieces.forEach(p => { p.state = 'wait'; }); at(0, 3); at(2, 5); s.turn = 0; s.phase = 'choose'; s.pending = [2]; s.throwsLeft = 0; Y.Act['skill-cancel'](); }""")
    wait_idle(page)
    page.click(".pchip.can", force=True)
    page.click(".dest[data-move='new/2']", force=True)
    page.wait_for_function("() => document.querySelector('#hint').textContent.includes('could have knocked out')", timeout=10000)
    check(True, "💡 잡을 수 있었는데 다른 수를 두면 '앗, 저기 잡을 수 있었어!'")
    page.screenshot(path=str(OUT / "99h-missed.png"))
    wait_idle(page)
    ctx.close()

    # 😈 로켓단은 판마다 무작위 (1단계 · 전설 아님 · 내 가족과 안 겹침)
    ctx, page = ctx_page()
    seen = []
    for k in range(2):
        page.goto(base + "?fast=1&spots=none"); page.wait_for_timeout(250)
        page.click("[data-act=new-rocket]"); page.click("[data-act=set][data-field=study][data-value='false']")
        page.click("[data-act=to-pick]"); page.click("[data-act=pick-auto]"); page.click("#pick-next")
        page.wait_for_selector("#ri-go"); page.click("#ri-go")
        bag0 = sum(ev(page, "Object.values(d.bag)"))
        page.wait_for_selector(".gacha-ov .gacha-mon", timeout=15000)
        if k == 0: page.screenshot(path=str(OUT / "99g-gacha.png"))
        wait_idle(page)
        shown = page.evaluate("() => window.__gachaShown || null")
        check(sum(ev(page, "Object.values(d.bag)")) == bag0, "😼 로켓단 캡슐 뽑기: 보여 주기만 (지온이 가방은 그대로)")
        r = page.evaluate("""() => { const s = window.__yut.G.s, D = window.YUT_DATA, R = s.teams[1].picks, root = id => window.__yut.Yut.evoPath(id, D.evoFrom)[0];
          return { picks: R, roots: R.every(id => !D.evoFrom[id]), legend: R.some(id => D.rarity[id] === 'l'), clash: R.some(id => s.teams[0].paths.some(p => p[0] === root(id))) }; }""")
        seen.append(r["picks"])
        check(r["roots"] and not r["legend"] and not r["clash"], f"로켓단 말 무작위 {r['picks']} — 1단계 · 전설 아님 · 지온이 가족과 안 겹침")
    check(seen[0] != seen[1] and seen[0] != [24, 109, 52, 202], "로켓단 말이 판마다 달라짐")
    ctx.close()

    # 🎲 미래예지 확률 막대 · 💧🔥 상성 연출
    ctx, page = ctx_page()
    start(page, "?seed=2&spots=none&fast=1&noslot=1&early=1&pools=future,future", study=False)
    page.evaluate("() => { const Y = window.__yut, s = Y.G.s; Object.assign(s.pieces[0], { state: 'board', atGoal: false }, Y.Yut.settle('OUT', 3)); s.turn = 0; s.phase = 'throw'; s.throwsLeft = 1; s.pending = []; Y.Act['skill-cancel'](); }")
    wait_idle(page)
    page.click("#btn-skill"); page.click(".skill-item[data-act=skill-pick]")
    page.wait_for_selector(".modal .prob-bars", timeout=5000)
    bars = page.eval_on_selector_all(".modal .prob-bars div", "e => e.map(x => x.querySelector('b').textContent + x.querySelector('em').textContent)")
    check("Gae35%" in bars and "Geol35%" in bars and len(bars) == 6, f"미래예지에 확률 막대 ({bars})")
    page.wait_for_timeout(300)
    page.screenshot(path=str(OUT / "99i-prob.png"))
    page.click("[data-act=close-modal]")
    page.evaluate("""() => { const Y = window.__yut, s = Y.G.s, at = (i, n) => Object.assign(s.pieces[i], { state: 'board', atGoal: false }, Y.Yut.settle('OUT', n));
      s.teams[0].paths[0] = [7, 8, 9]; s.teams[1].paths[0] = [4, 5, 6]; s.pieces[0].stage = 0; s.pieces[2].stage = 0; s.settings.battle = true;
      at(0, 3); at(2, 5); s.turn = 0; s.phase = 'choose'; s.pending = [2]; s.throwsLeft = 0; Y.Act['skill-cancel'](); }""")
    wait_idle(page)
    page.click(".unit.can[data-node='3']", force=True)
    page.click(".dest[data-move='n3/2']", force=True)
    # 도장은 빠르게 모드에서 0.3초쯤만 떠 있다 — wait_for_selector 는 오래 기다리면 1초마다만 보므로 놓친다 → 0.05초마다 본다
    page.wait_for_function("() => !!document.querySelector('.bt-stamp.super')", polling=50, timeout=20000)
    check("Fire" in page.inner_text(".bt-text") or "super effective" in page.inner_text(".bt-stage"), "💧 꼬부기가 🔥 파이리를 잡으면 '효과가 굉장했다!'")
    page.screenshot(path=str(OUT / "99j-super.png"))
    while page.query_selector(".bt-skip"):
        page.click(".bt-skip", force=True); page.wait_for_timeout(200)
    ctx.close()

    # ⑪ 🎁 기술을 못 쓰고 골인 → 받을 팀원 고르기 → 기술 두 개 → 받은 기술 쓰기
    ctx, page = ctx_page()
    start(page, "?seed=2&spots=none&fast=1&early=1&pools=nitro,ddance,surf|toxic,quake,splash", study=False)
    page.evaluate("""() => { const Y = window.__yut, s = Y.G.s, at = (i, n) => Object.assign(s.pieces[i], { state: 'board', atGoal: false }, Y.Yut.settle('OUT', n));
      at(0, 18); at(1, 3); s.turn = 0; s.phase = 'choose'; s.pending = [3]; s.throwsLeft = 0; Y.Act['skill-cancel'](); }""")
    wait_idle(page)
    page.click(".unit.can[data-node='18']", force=True)
    page.click(".dest.goal", force=True)
    page.wait_for_selector(".modal .gift-pick", timeout=20000)
    page.wait_for_timeout(400)
    txt = page.inner_text(".modal")
    check("Flame Charge" in txt and "Who gets it" in txt and len(page.query_selector_all(".modal .gift-pick")) == 1, "기술을 못 쓰고 골인하면 받을 팀원 고르기 (골인 안 한 팀원만)")
    measure(page, "🎁 받을 팀원 고르기")
    page.screenshot(path=str(OUT / "99d-gift-choose.png"))
    page.click(".modal .gift-pick[data-to='1']")
    wait_idle(page)
    check(ev(page, "JSON.stringify(s.pieces[1].gift)") == '{"key":"nitro","used":false}' and page.query_selector(".pchip[data-piece='1'] .sk.gift") is not None, "받은 기술이 팀원에게 (칩에 🎁)")
    page.evaluate("() => { const s = window.__yut.G.s; s.turn = 0; s.turnNo += 2; s.phase = 'throw'; s.throwsLeft = 1; s.pending = []; window.__yut.Act['skill-cancel'](); }")
    wait_idle(page)
    page.click("#btn-skill")
    page.wait_for_selector(".skill-item[data-act=skill-pick]", timeout=5000)
    slots = page.eval_on_selector_all(".skill-item[data-act=skill-pick]", "e => e.map(x => x.dataset.piece + ':' + x.dataset.slot)")
    check(slots == ["1:own", "1:gift"], f"기술 두 개 — 제 기술 + 🎁 받은 기술 ({slots})")
    page.screenshot(path=str(OUT / "99e-two-skills.png"))
    page.click(".skill-item[data-slot='gift']")
    wait_idle(page)
    check(ev(page, "[s.pieces[1].gift.used, s.pieces[1].used, window.__yut.Yut.posOf(s.pieces[1])]") == [True, False, 5], "받은 니트로차지를 쓰면 받은 것만 씀 (3 → 5)")
    page.click(".pchip[data-piece='1']")
    page.wait_for_selector(".modal .pi-skill", timeout=5000)
    check("Gift move" in page.inner_text(".modal"), "기술 보기 창에 받은 기술")
    ctx.close()

    # ⑩ v8: 전설도 10칸 · 기술 성공 90% + 👑 전설 연출
    ctx, page = ctx_page()
    page.add_init_script("if (!localStorage.getItem('engmon_yut_en_v1')) localStorage.setItem('engmon_yut_en_v1', JSON.stringify({ collection: [{ id: 150, t: 1 }] }));")
    # 빠르게 모드에서는 배너가 0.2초만 떠서 기다리기로는 놓친다 — 뜨는 배너를 모두 적어 둔다
    page.add_init_script("window.__banners = []; new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.classList && n.classList.contains('banner') && n.classList.contains('legend')) window.__banners.push(n.textContent); }))).observe(document, { childList: true, subtree: true });")
    page.goto(base + "?seed=2&spots=none&fast=1&pools=nitro,nitro&luck=1")
    page.wait_for_timeout(300)
    page.click("[data-act=new-family]"); page.click("[data-act=set][data-field=pieces][data-value='2']")
    page.click("[data-act=to-pick]")
    page.evaluate("() => { window.__yut.Setup.picks[0] = []; }")
    page.click(".pcard[data-id='150']"); page.click(".pcard[data-id='4']"); page.click("#pick-next")
    page.click("[data-act=pick-auto]"); page.click("#pick-next")
    wait_idle(page)
    check(page.evaluate("() => window.__banners.some(t => t.includes('Legendary'))"), "👑 전설: 판을 시작할 때 금빛 배너")
    check(ev(page, "JSON.stringify(s.teams[0].need)") == "[10,10]" and ev(page, "s.pieces[0].skill") is None,
          "v8: 뮤츠(전설)도 10칸에 기술")
    check(page.evaluate("() => window.__banners.some(t => t.includes('90%'))"), "전설 배너에 '기술 성공 90%'")
    page.evaluate("() => { const Y = window.__yut, s = Y.G.s; Object.assign(s.pieces[0], { state: 'board', atGoal: false, walk: 10, skill: 'nitro', used: false }, Y.Yut.settle('OUT', 3)); s.turn = 0; s.phase = 'throw'; s.throwsLeft = 1; s.pending = []; Y.Act['skill-cancel'](); }")
    wait_idle(page)
    check(page.query_selector("#units .unit.legend") is not None, "윷판 위 전설 말은 금빛 받침 + 👑")
    page.click("#btn-skill"); page.click(".skill-item[data-act=skill-pick]")
    crown = page.wait_for_selector(".cutin.legend .ci-crown", timeout=5000).text_content()  # 빠르게 모드라 0.3초 안에 닫힌다 — 바로 읽기
    check("Legendary power" in crown, "전설 기술 장면: 무지개 띠 + 👑 전설의 힘!")
    wait_idle(page)
    page.click(".pchip[data-piece='1']")
    page.wait_for_selector(".modal .pi-pool", timeout=5000)
    check("10 spaces" in page.inner_text(".modal") and "Rare" in page.inner_text(".modal"), "기술 보기 창: 희귀도와 남은 칸 (레어 10칸)")
    ctx.close()

    # ⑧ 로켓단이 이겨도 위로 상자: 몬스터볼 1개 + 💰 돈 문제로 하나 더
    ctx, page = ctx_page()
    start(page, "?seed=2&fast=1&money=0,1,2,3", mode="rocket")
    bag0 = sum(ev(page, "Object.values(d.bag)"))
    page.evaluate("""() => { const Y = window.__yut, s = Y.G.s; Object.assign(s.pieces[2], { state: 'done' });
      Object.assign(s.pieces[3], { state: 'board', route: 'OUT', step: 19, atGoal: false }); s.phase = 'choose'; s.pending = [3]; s.throwsLeft = 0; s.turn = 1; }""")
    page.evaluate("() => window.__yut.Act['skill-cancel']()")  # 로켓단이 스스로 골인
    page.wait_for_selector(".win-screen .chest", timeout=30000)
    check("gift chest" in page.inner_text(".win-screen") and ev(page, "JSON.stringify(d.lastGame.reward.balls)") == '["poke"]', "로켓단이 이겨도 위로 상자 (몬스터볼 1개)")
    page.screenshot(path=str(OUT / "98-lose-box.png"))
    page.click(".win-screen .chest", force=True)
    # 🏥 돈 문제도 틀리면 같은 단계: ① 틀림 → ① 다른 손님 맞힘(+3) → ② 틀림 = +3%만 (유니크·전설 13%)
    page.wait_for_selector(".quiz .qz-choice:not([disabled])", timeout=20000)
    rows = page.eval_on_selector_all(".quiz .mrow", "e => e.map(x => x.innerText.replace(/\\s+/g, ' ').trim())")
    check(len(rows) == 3 and "10000" in rows[0] and "× 1" in rows[0] and "1000" in rows[1] and "× 2" in rows[1] and "100" in rows[2] and "× 3" in rows[2],
          f"💰 돈은 한 장 + '× 개수' 한 줄씩 ({rows})")
    page.screenshot(path=str(OUT / "97-money-rows.png"))
    answer_quiz(page, right=False, timeout=20000)
    page.wait_for_selector(".quiz .qz-choice:not([disabled])", timeout=20000)
    t2 = page.inner_text(".quiz .qz-title")
    check("2/3" in t2 and "up to 1,000 won" in t2 and "+3%" in t2 and "One more try" in page.inner_text(".quiz .cs-say"), "🏥 ① 틀리면 ① 천 원 손님이 한 번 더")
    answer_quiz(page, timeout=20000)
    page.wait_for_selector(".quiz .qz-choice:not([disabled])", timeout=20000)
    t3 = page.inner_text(".quiz .qz-title")
    check("3/3" in t3 and "up to 1,000 won" in t3 and "Level 2" in t3 and "+3%" in t3, "① 맞히면 마지막 기회는 ② 단계 (② 도 천 원 단위)")
    answer_quiz(page, right=False, timeout=20000)
    page.wait_for_selector(".center-ov .cv-ball", timeout=15000)
    check(ev(page, "JSON.stringify(d.lastGame.reward.bonus.odds)") == '{"c":47,"r":27,"u":13,"l":13}', "① 틀림 · ① 맞힘 · ② 틀림 → +3%만 (유니크·전설 13%)")
    page.click(".center-ov .cv-ball", force=True)
    page.wait_for_selector(".center-ov .cv-mon", timeout=15000)
    page.click("[data-act=center-close]")
    page.wait_for_selector(".win-btns:not(.hidden)", timeout=15000)
    check(sum(ev(page, "Object.values(d.bag)")) == bag0 + 1 and ev(page, "d.lastGame.reward.bonus.mon"), "져도 몬스터볼 1개 + 포켓몬센터 몬스터볼(포켓몬 1마리)")
    ctx.close()

    # ⑨ 🔍 오른쪽 팀 카드의 포켓몬을 누르면 기술 보기 (던지기 차례 · 상대 팀 · 아직 없는 기술)
    ctx, page = ctx_page()
    start(page, "?seed=2&spots=none&fast=1&early=1&pools=nitro,surf|toxic,quake")
    page.click(".pchip[data-piece='0']")
    page.wait_for_selector(".modal .pi-skill", timeout=5000)
    txt = page.inner_text(".modal")
    check("Flame Charge" in txt and "2 spaces" in txt, "내 포켓몬을 누르면 기술 이름·설명이 보임")
    page.wait_for_timeout(400)
    measure(page, "🔍 포켓몬·기술 보기")
    page.screenshot(path=str(OUT / "99-piece-info.png"))
    page.click("[data-act=close-modal]")
    page.click(".pchip[data-piece='3']")
    page.wait_for_selector(".modal .pi-skill", timeout=5000)
    check("Earthquake" in page.inner_text(".modal"), "상대 팀 포켓몬 기술도 볼 수 있음")
    page.click("[data-act=close-modal]")
    ctx.close()
    ctx, page = ctx_page(390, 844)
    start(page, "?seed=2&spots=none&fast=1")
    page.click(".pchip[data-piece='0']")
    page.wait_for_selector(".modal .pi-pool", timeout=5000)
    txt = page.inner_text(".modal")
    need = ev(page, "window.__yut.Yut.skillNeed(s, 0)")
    check(f"{need} spaces" in txt and "learn one of these" in txt and need == 10, f"아직 기술이 없으면 남은 칸({need}칸 — 스타팅은 모두 10칸)과 배울 수 있는 기술 후보")
    check(ev(page, "JSON.stringify(s.teams.map(t => t.need))") == "[[10,10],[10,10]]", "스타팅 포켓몬은 세대와 상관없이 모두 10칸")
    page.wait_for_timeout(400)
    page.screenshot(path=str(OUT / "99-piece-info-phone.png"))
    measure(page, "🔍 포켓몬·기술 보기 (폰)")
    ctx.close()


def scenario_v8(browser, base, errors):
    """v8: ✨ 기술 36개 (새 기술 쓰기·효과 표시) · 🎲 발동 확률 (성공 %·상성·실패하면 기술이 남음)."""
    def ctx_page(vw=1180, vh=820):
        ctx = browser.new_context(viewport={"width": vw, "height": vh}, has_touch=True)
        ctx.add_init_script("localStorage.setItem('engmon_yut_en_v1', JSON.stringify({ settings: { study: false } }));")
        # 빠르게 모드에서는 안내가 금방 바뀐다 — 안내 칸에 뜬 글을 모두 적어 둔다
        ctx.add_init_script("window.__hints = []; window.__rolls = []; new MutationObserver(ms => ms.forEach(m => { const t = m.target; if (t && t.id === 'hint') window.__hints.push(t.textContent); if (t && t.classList && t.classList.contains('roll-res') && t.textContent) window.__rolls.push(t.textContent); })).observe(document, { childList: true, subtree: true });")
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
        page.on("console", lambda m: errors.append("console: " + m.text) if m.type == "error" else None)
        return ctx, page

    def start(page, query, pieces=4):
        page.goto(base + query)
        page.wait_for_timeout(300)
        page.click("[data-act=new-family]")
        page.click(f"[data-act=set][data-field=pieces][data-value='{pieces}']")
        page.click("[data-act=to-pick]")
        page.click("[data-act=pick-auto]"); page.click("#pick-next")
        page.click("[data-act=pick-auto]"); page.click("#pick-next")
        wait_idle(page)

    def inject(page, js):
        page.evaluate("""() => { const Y = window.__yut, G = Y.G, s = G.s;
          const at = (i, n, walk) => Object.assign(s.pieces[i], { state: 'board', atGoal: false, walk: walk || 0 }, Y.Yut.settle('OUT', n));
          const reset = () => { s.pieces.forEach(p => Object.assign(p, { state: 'wait', route: 'OUT', step: 0, atGoal: false, fx: {} })); s.traps = []; s.teams.forEach(t => { t.fx = {}; }); };
          const fresh = (team, phase, pending) => { s.turn = team; s.turnNo += 2; s.phase = phase || 'throw'; s.throwsLeft = phase === 'choose' ? 0 : 1; s.pending = pending || []; };
          """ + js + """;
          Y.Act['skill-cancel'](); }""")
        wait_idle(page)

    ev = lambda page, js: page.evaluate("() => { const Y = window.__yut, G = Y.G, s = G.s; return " + js + "; }")

    def open_skill(page, key):
        page.wait_for_selector("#btn-skill:not([hidden])", timeout=10000)
        page.click("#btn-skill")
        page.wait_for_selector(".skill-item[data-act=skill-pick]", timeout=5000)
        name = ev(page, f"Y.Yut.SKILLS['{key}'].name")
        pick = next((it for it in page.query_selector_all(".skill-item[data-act=skill-pick]") if name in it.inner_text()), None)
        check(pick is not None, f"기술 창에 {name}")
        return pick

    def use_on(page, key, node):
        pick = open_skill(page, key)
        if not pick: return ""
        pick.click()
        sel = f"#dests .dest.skill-t[data-node='{node}']"
        page.wait_for_selector(sel, timeout=5000)
        label = page.inner_text(sel)
        page.click(sel, force=True)
        wait_idle(page)
        return label

    # ① 새 기술: 아이스차징 · 사이드체인지 · 자력선 · 독압정 (늘 성공 ?luck=1)
    ctx, page = ctx_page()
    start(page, "?seed=2&spots=none&fast=1&early=1&luck=1&pools=icecharge,allyswitch,magnet,spike|nitro,nitro,nitro,nitro")
    inject(page, "reset(); fresh(0); at(0, 3); at(4, 10); at(5, 13)")
    label = use_on(page, "icecharge", 10)
    check("Freeze" in label and "100%" in label, f"아이스차징 대상 말풍선에 성공 확률 ({label.strip()})")
    check(ev(page, "(s.pieces[4].fx || {}).freeze > 0 && s.teams[1].fx.chill > 0"), "아이스차징: 얼음 + 그 팀 윷이 작아짐")
    check(page.evaluate("() => window.__rolls.some(t => t.includes('Success'))"), "🎲 확률 막대 → '성공! ✨'")
    badge = page.query_selector("#units .unit[data-node='10'] .badge-s")
    check(badge is not None and "🧊" in badge.inner_text(), "얼은 말 모서리에 🧊")
    check("🧊" in (page.query_selector_all(".tcard")[1].inner_text() if len(page.query_selector_all(".tcard")) > 1 else ""), "상대 팀 카드에 🧊 (윷이 작아짐)")
    page.screenshot(path=str(OUT / "v8-1-icecharge.png"))
    inject(page, "reset(); fresh(0); at(1, 4); at(5, 14)")
    use_on(page, "allyswitch", 14)
    check(ev(page, "[Y.Yut.posOf(s.pieces[1]), Y.Yut.posOf(s.pieces[5])]") == [14, 4], "사이드체인지: 우리 말 ↔ 상대 말")
    check(page.query_selector("#units .unit[data-team='0'][data-node='14']") is not None and page.query_selector("#units .unit[data-team='1'][data-node='4']") is not None, "사이드체인지: 판 위 말 그림도 자리 바꿈")
    inject(page, "reset(); fresh(0); at(2, 9); at(3, 3)")
    use_on(page, "magnet", 3)
    check(ev(page, "Y.Yut.posOf(s.pieces[3])") == 9 and len(page.query_selector_all("#units .unit[data-team='0']")) == 1, "자력선: 뒤의 우리 말을 끌어와 업음 (말 그림 하나)")
    inject(page, "reset(); fresh(0); at(3, 3)")
    use_on(page, "spike", 9)
    trap = page.query_selector("#traps .trap[data-node='9']")
    check(trap is not None and "🟣" in trap.inner_text(), "독압정: 빈 칸에 🟣")
    page.screenshot(path=str(OUT / "v8-2-spike.png"))
    # 상대가 압정 칸에 멈추면 다음 차례에 못 움직임 (표시 🟣)
    inject(page, "fresh(1, 'choose', [2]); at(4, 7)")
    page.click(".unit.can[data-node='7']", force=True)
    page.click(".dest[data-move='n7/2']", force=True)
    wait_idle(page)
    check(ev(page, "(s.pieces[4].fx || {}).spike > 0") and page.query_selector("#traps .trap[data-node='9']") is None, "상대가 압정에 멈추면 🟣 한 번 쉼, 압정은 사라짐")
    ctx.close()

    # ② 🎲 확률: 기술 창에 성공 % · 상성 −10% · 실패하면 기술이 남음 → 다음 차례에 다시
    ctx, page = ctx_page()
    start(page, "?seed=2&spots=none&fast=1&early=1&luck=no&pools=flame,nitro|nitro,nitro", pieces=2)
    check(ev(page, "JSON.stringify(s.teams[0].rar)") == '["r","r"]', "스타팅 포켓몬은 레어 확률 (70%)")
    inject(page, "reset(); fresh(0); at(0, 3); at(2, 5); s.teams[0].rar = ['c', 'c']; s.teams[1].types[0] = s.teams[1].paths[0].map(() => ['물'])")
    pick = open_skill(page, "flame")
    txt = pick.inner_text() if pick else ""
    check("Success 60%" in txt and "matchup" in txt, f"기술 창: 성공 확률 + 상성 안내 ({txt.splitlines()[-1] if txt else ''})")
    page.screenshot(path=str(OUT / "v8-3-chance-menu.png"))
    # 실패하는 난수를 골라 둔다
    page.evaluate("""() => { const Y = window.__yut, s = Y.G.s;
      for (let k = 1; k < 500; k++) { const c = Y.Yut.clone(s); c.srng = k; const r = Y.Yut.applySkill(c, 0, 5); if (r.events.some(e => e.type === 'skillfail')) { s.srng = k; break; } } }""")
    pick.click()
    page.wait_for_selector("#dests .dest.skill-t[data-node='5']", timeout=5000)
    label = page.inner_text("#dests .dest.skill-t[data-node='5']")
    check("50%" in label and "💧" in label, f"물 타입 상대에게 화염방사: 50% 💧 ({label.strip()})")
    page.screenshot(path=str(OUT / "v8-4-chance-target.png"))
    page.click("#dests .dest.skill-t[data-node='5']", force=True)
    try:
        page.wait_for_selector(".roll.no", timeout=10000); page.screenshot(path=str(OUT / "v8-6-roll-fail.png"))
    except Exception:
        pass
    wait_idle(page)
    hints = page.evaluate("() => window.__hints.join(' | ')")
    check("missed" in hints and "not very effective" in hints, "실패 안내 + '효과가 별로인 듯하다'")
    check(page.evaluate("() => window.__rolls.some(t => t.includes('Missed'))"), "🎲 확률 막대에서 바늘이 회색(실패)에 멈추고 '실패… 😵'")
    check(ev(page, "[s.pieces[0].used, s.pieces[2].state]") == [True, "board"], "실패: 기술이 사라짐 (쓴 것으로)")
    check(page.query_selector(".pchip[data-piece='0'] .sk.used") is not None, "실패한 말 칩에 ✓ (다 씀)")
    inject(page, "fresh(0)")
    check(not ev(page, "Y.Yut.legalSkills(s).some(x => x.piece === 0)"), "다음 차례에도 못 씀")
    # 🔍 기술 보기 창에 확률
    page.click(".pchip[data-piece='0']")
    page.wait_for_selector(".modal .pi-skill", timeout=5000)
    check("60%" in page.inner_text(".modal"), "기술 보기 창에 성공 확률")
    page.click("[data-act=close-modal]")
    ctx.close()

    # ③ 💤 수면가루 — 차례가 시작될 때 깰까? 안내
    ctx, page = ctx_page()
    start(page, "?seed=2&spots=none&fast=1&early=1&luck=1&pools=sleep,nitro|nitro,nitro", pieces=2)
    inject(page, "reset(); fresh(0); at(0, 3); at(1, 8); at(2, 10)")
    use_on(page, "sleep", 10)
    check(ev(page, "(s.pieces[2].fx || {}).sleep > 0"), "수면가루: 잠")
    page.evaluate("() => { window.__hints = []; }")
    inject(page, "fresh(0, 'choose', [1])")
    page.click(".unit.can[data-node='8']", force=True)
    page.click(".dest[data-move='n8/1']", force=True)
    wait_idle(page)
    hints = page.evaluate("() => window.__hints.join(' | ')")
    check("woke up" in hints or "kept sleeping" in hints, "상대 차례가 시작되면 '깼다!' 또는 '아직 쿨쿨…' (20%)")
    ctx.close()

    # ④ 폰 크기: 기술 창 확률 줄이 넘치지 않음
    ctx, page = ctx_page(390, 844)
    start(page, "?seed=2&spots=none&fast=1&early=1&luck=no&pools=outrage,stoneedge|nitro,nitro", pieces=2)
    inject(page, "reset(); fresh(0); at(0, 3); at(1, 7); at(2, 4); at(3, 12)")
    open_skill(page, "outrage")
    page.wait_for_timeout(800)
    measure(page, "🎲 기술 창 (폰)")
    page.screenshot(path=str(OUT / "v8-5-phone-menu.png"))
    ctx.close()


def scenario_save(browser, base, errors):
    """👤 프로필 + 💾 저장 코드: 예전 기록 → 지온이 · 프로필마다 코드(6자리) · 저절로 저장 · 다른 패드에서 불러오기(같은 프로필이면 글자 확인, 없으면 바로 생김) · 두 패드 합치기 · 끄기."""
    sys.path.insert(0, str(ROOT / "tools"))
    from fake_firebase import FakeFirebase
    fdb = FakeFirebase()
    dburl = fdb.start()
    q = "?fast=1&db=" + dburl

    def mk(save):
        ctx = browser.new_context(viewport={"width": 1180, "height": 820}, has_touch=True)
        ctx.add_init_script("if (!localStorage.getItem('engmon_yut_en_v1')) localStorage.setItem('engmon_yut_en_v1', " + json.dumps(json.dumps(save)) + ");")
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
        page.on("console", lambda m: errors.append("console: " + m.text) if m.type == "error" and "ERR_" not in m.text else None)
        return ctx, page
    ev = lambda page, js: page.evaluate("() => { const Y = window.__yut, d = Y.Store.data, P = d.profiles; return " + js + "; }")
    server = lambda code: json.loads(((fdb.data.get("yutsaves") or {}).get(code) or {}).get("dataJ", "null") or "null")

    actx, a = mk({"collection": [{"id": 133, "t": 1}, {"id": 25, "t": 2}], "bag": {"poke": 5, "great": 1, "ultra": 0, "luxury": 0, "master": 0}, "stats": {"games": 4, "family": {"kid": 2}, "rocket": {"win": 1, "lose": 0}}})
    a.goto(base + q); a.wait_for_timeout(300)
    check(ev(a, "P.kid.collection.map(x => x.id).join(',')") == "133,25" and ev(a, "P.kid.bag.poke") == 5 and ev(a, "P.kid.stats.family.win") == 2 and ev(a, "P.kid.name") == "Dreamer" and ev(a, "d.order.length") == 6,
          "👤 예전 기록(패드 하나)은 🧒 지온이 프로필로 · 가족 6명 프로필")
    a.click("[data-act=profiles]")
    a.wait_for_selector(".prof-card")
    check(len(a.query_selector_all(".prof-card")) == 6 and "2 Pokémon" in a.inner_text(".prof-card[data-id=kid]"), "프로필 화면: 사람마다 캐릭터 · 포켓몬 수 · 볼 · 판 수")
    measure(a, "👤 프로필 화면")
    a.screenshot(path=str(OUT / "s0-profiles.png"))
    # ✏️ 꾸미기: 캐릭터는 내 포켓몬 중에서 (잡은 이브이 포함)
    a.click("[data-act=prof-edit][data-id=kid]")
    a.wait_for_selector(".av-pick")
    check(a.query_selector(".av-pick[data-id='133']") is not None and len(a.query_selector_all(".av-pick")) == 29, "캐릭터는 내 포켓몬 중에서 (스타팅 27 + 잡은 2)")
    a.wait_for_timeout(400)
    measure(a, "✏️ 프로필 꾸미기")
    a.click(".av-pick[data-id='133']"); a.click("[data-act=prof-ok]")
    a.wait_for_timeout(300)
    check(ev(a, "P.kid.avatar") == 133, "캐릭터 바꾸기 (이브이)")
    # ➕ 새 프로필: 이름 없이는 안 됨 → 이름 쓰고 만들기 (볼 3개 · 포켓몬 0)
    a.click("[data-act=prof-new]"); a.wait_for_selector("#prof-name")
    a.click("[data-act=prof-ok]")
    check("name" in a.inner_text("#prof-err"), "새 프로필: 이름을 써야 만들어짐")
    a.fill("#prof-name", "하윤이"); a.click(".av-pick[data-id='4']"); a.click("[data-act=prof-ok]")
    a.wait_for_timeout(300)
    hid = ev(a, "d.order[d.order.length - 1]")
    check(ev(a, f"P['{hid}'].name") == "하윤이" and ev(a, f"P['{hid}'].bag.poke") == 3 and ev(a, f"P['{hid}'].collection.length") == 0, "새 프로필은 처음 선물 볼 3개 · 포켓몬 0")
    # 💾 지온이 저장 켜기
    a.click("[data-act=prof-save][data-id=kid]"); a.click("[data-act=save-on]")
    a.wait_for_selector(".modal .save-code b", timeout=10000)
    code = "".join(a.eval_on_selector_all(".modal .save-code b", "e => e.map(x => x.textContent)"))
    check(len(code) == 6 and code.isdigit() and "photo" in a.inner_text(".modal"), f"💾 지온이 저장 켜기 → 코드 6자리 ({code}) + 사진 안내")
    a.wait_for_timeout(500)
    measure(a, "💾 저장 코드 창")
    x = server(code)
    check(x and x["id"] == "kid" and x["name"] == "Dreamer" and x["avatar"] == 133 and [c["id"] for c in x["collection"]] == [133, 25] and x["bag"]["poke"] == 5, "서버에 지온이 프로필(이름 · 캐릭터 · 포켓몬 · 볼)")
    a.click("[data-act=close-modal]")
    check(code in a.inner_text(".prof-card[data-id=kid]"), "프로필 카드에 💾 코드")
    a.click(f"[data-act=prof-save][data-id='{hid}']"); a.click("[data-act=save-on]")
    a.wait_for_selector(".modal .save-code b", timeout=10000)
    code2 = "".join(a.eval_on_selector_all(".modal .save-code b", "e => e.map(x => x.textContent)"))
    check(code2 != code and server(code2)["name"] == "하윤이", f"프로필마다 코드가 따로 ({code2})")
    a.click("[data-act=close-modal]")
    # 저절로 저장: 지온이가 잡으면 몇 초 뒤 서버에 (하윤이 것은 그대로)
    a.evaluate("() => { const S = window.__yut.Store; S.data.profiles.kid.collection.push({ id: 7, t: 3 }); S.data.profiles.kid.bag.poke = 4; S.save(); }")
    a.wait_for_timeout(5200)
    check([c["id"] for c in server(code)["collection"]] == [133, 25, 7] and server(code)["bag"]["poke"] == 4 and server(code2)["collection"] == [], "지온이 기록이 바뀌면 지온이 코드에만 저절로 저장")

    # 🥇 랭킹: 저장을 켠 프로필만, 저장 코드는 안 보임, 필터마다 순서
    rk = fdb.data.get("yutrank") or {}
    check(len(rk) == 2 and code not in rk and code2 not in rk and all("code" not in v and set(v) >= {"name", "mons", "legends", "wins"} for v in rk.values()),
          f"🥇 랭킹 서버엔 이름·캐릭터·숫자만 (저장 코드 없음) — {len(rk)}명")
    kid_r = next(v for v in rk.values() if v["name"] == "Dreamer")
    check(kid_r["mons"] == 3 and kid_r["avatar"] == 133, f"지온이 랭킹 숫자 (포켓몬 {kid_r['mons']} · 전설 {kid_r['legends']} · 승리 {kid_r['wins']})")
    fdb.data["yutrank"]["zzzzzzzzz1"] = {"name": "민준", "avatar": 25, "mons": 9, "legends": 2, "wins": 1, "updated": 1}
    fdb.data["yutrank"]["zzzzzzzzz2"] = {"name": "서아", "avatar": 1, "mons": 1, "legends": 0, "wins": 7, "updated": 1}
    a.click("[data-act=home]"); a.click("[data-act=rank]")
    a.wait_for_selector(".rank-row", timeout=10000)
    names = lambda: a.eval_on_selector_all(".rank-row .rk-name", "e => e.map(x => x.childNodes[0].textContent.trim())")
    check(names()[:2] == ["민준", "Dreamer"] and "🥇" in a.inner_text(".rank-row.t1"), f"📕 포켓몬 수로 줄 세우기 {names()}")
    check(len(a.query_selector_all(".rank-row.me")) == 2 and "Mom" not in a.inner_text("#rank-list") + a.inner_text("#rank-note") and "Make a save code" in a.inner_text("#rank-note"),
          "우리 패드 프로필은 '우리' 표시 · 등록 안 한 사람은 이름도 안 보임")
    a.click("[data-act=rank-by][data-by=wins]"); a.wait_for_timeout(200)
    check(names()[0] == "서아", f"🏆 승리 수로 {names()}")
    a.click("[data-act=rank-by][data-by=legends]"); a.wait_for_timeout(200)
    check(names()[0] == "민준", f"👑 전설 수로 {names()}")
    measure(a, "🥇 랭킹 화면")
    a.screenshot(path=str(OUT / "s5-rank.png"))
    a.click("[data-act=home]")

    # 다른 패드: 틀린 코드 → 지온이 코드(같은 프로필이 있음 → 글자 확인) → 하윤이 코드(없음 → 바로 생김)
    bctx, b = mk({"settings": {"study": False}})
    b.goto(base + q); b.wait_for_timeout(300)
    b.click("[data-act=profiles]"); b.click("[data-act=save-load]")
    wrong = "111111" if code != "111111" else "222222"
    for k in wrong: b.click(f"[data-act=save-key][data-k='{k}']")
    b.click("#save-fetch")
    b.wait_for_function("() => document.querySelector('#save-err').textContent.length > 0", timeout=10000)
    check("no save" in b.inner_text("#save-err"), "없는 코드면 '그런 저장이 없어요'")
    for _ in range(6): b.click("[data-act=save-key][data-k='del']")
    for k in code: b.click(f"[data-act=save-key][data-k='{k}']")
    measure(b, "📥 불러오기 숫자판")
    b.click("#save-fetch")
    b.wait_for_selector("#confirm-in", timeout=10000)
    check("gone" in b.inner_text(".modal") and "3 Pokémon" in b.inner_text(".modal"), "같은 프로필(지온이)이 있으면 '사라져요' 확인 + 미리 보기")
    check(b.query_selector("#confirm-yes").is_disabled(), "글자를 쓰기 전엔 불러오기 버튼이 꺼짐")
    b.fill("#confirm-in", "load"); b.click("#confirm-yes")
    b.wait_for_timeout(500)
    check(ev(b, "P.kid.collection.map(x => x.id).join(',')") == "133,25,7" and ev(b, "P.kid.bag.poke") == 4 and ev(b, "P.kid.avatar") == 133 and ev(b, "P.kid.cloud.code") == code,
          "불러오면 지온이가 저장된 기록·캐릭터로 바뀌고 같은 코드로 저장 켜짐")
    b.click("[data-act=save-load]")
    for k in code2: b.click(f"[data-act=save-key][data-k='{k}']")
    b.click("#save-fetch")
    b.wait_for_function(f"() => !!window.__yut.Store.data.profiles['{hid}']", timeout=10000)
    check(ev(b, "d.order.length") == 7 and ev(b, f"P['{hid}'].name") == "하윤이", "없는 프로필(하윤이)은 바로 생김")
    b.evaluate("() => { const S = window.__yut.Store; S.data.profiles.kid.bag.poke = 9; S.save(); }")
    b.wait_for_timeout(5200)
    check(len([v for v in fdb.data["yutrank"].values() if v["name"] == "Dreamer"]) == 1, "다른 패드에서 불러와 저장해도 랭킹엔 한 줄 (같은 랭킹 번호)")
    b.screenshot(path=str(OUT / "s3-save-load.png"))

    # 두 패드의 지온이: 잡은 포켓몬은 합치고, 볼은 나중에 저장한 쪽
    b.evaluate("() => { const S = window.__yut.Store; S.data.profiles.kid.collection.push({ id: 152, t: 10 }); S.save(); }")
    b.wait_for_timeout(5200)
    a.evaluate("() => { const S = window.__yut.Store; S.data.profiles.kid.collection.push({ id: 4, t: 11 }); S.data.profiles.kid.bag.poke = 2; S.save(); }")
    a.wait_for_timeout(5200)
    x = server(code)
    check(sorted(c["id"] for c in x["collection"]) == [4, 7, 25, 133, 152] and x["bag"]["poke"] == 2, "두 패드가 잡은 포켓몬은 합치고, 볼은 나중에 저장한 쪽")
    b.reload(); b.wait_for_timeout(1500)
    check(ev(b, "P.kid.collection.map(x => x.id).sort((p, q) => p - q).join(',')") == "4,7,25,133,152", "처음 화면에 오면 다른 패드 기록을 받아 옴")
    # 끄기 · 지우기 (마지막 하나는 못 지움)
    b.click("[data-act=profiles]"); b.click("[data-act=prof-save][data-id=kid]"); b.click("[data-act=save-off]")
    b.wait_for_timeout(200)
    check(ev(b, "P.kid.cloud") is None, "저장 끄기")
    b.click(f"[data-act=prof-del][data-id='{hid}']")
    b.wait_for_selector("#confirm-in"); b.fill("#confirm-in", "delete"); b.click("#confirm-yes")
    b.wait_for_timeout(300)
    check(ev(b, f"!P['{hid}'] && d.order.length === 6"), "프로필 지우기 (글자를 써야)")
    actx.close(); bctx.close()

    # 👤 새 패드: 프로필은 지온이 하나 → 가족 대결 두 번째 팀은 ➕ 새 프로필로
    nctx, n = mk({})
    n.goto(base + "?fast=1&fam=0"); n.wait_for_timeout(300)
    check(ev(n, "d.order.join(',')") == "kid" and ev(n, "P.kid.name") == "Dreamer", "👤 처음엔 프로필 하나 (꿈꾸는아이)")
    n.click("[data-act=new-family]")
    check("New profile" in n.inner_text(".card") and n.query_selector("[data-act=set][data-field=t1].on") is None, "가족 대결: 두 번째 팀이 없으면 ➕ 새 프로필 안내")
    n.click("[data-act=to-pick]"); n.wait_for_timeout(200)
    check(n.query_selector(".pcard") is None, "두 번째 팀 없이는 고르기로 안 넘어감")
    n.click("[data-act=prof-new][data-field=t1]"); n.wait_for_selector("#prof-name")
    n.fill("#prof-name", "Mom"); n.click("[data-act=prof-ok]"); n.wait_for_timeout(300)
    check(n.query_selector("[data-act=set][data-field=t1].on") is not None and "Mom" in n.inner_text("[data-act=set][data-field=t1].on"), "➕ 새 프로필로 만들면 두 번째 팀으로 바로 골라짐")
    n.click("[data-act=to-pick]"); n.wait_for_selector(".pcard", timeout=5000)
    check(True, "두 번째 팀이 생기면 고르기로")
    nctx.close()
    # 예전 버전 패드: 안 쓴 가족 프로필은 치우고, 쓴 프로필은 그대로
    old6 = {"profiles": {k: {"id": k, "name": nm, "avatar": 1, "collection": [], "bag": {"poke": 3}, "stats": {}, "study": {}} for k, nm in
            [("kid", "Jion"), ("mom", "Mom"), ("dad", "Dad"), ("aunt", "Aunt"), ("grandma", "Grandma"), ("grandpa", "Grandpa")]}, "order": ["kid", "mom", "dad", "aunt", "grandma", "grandpa"]}
    old6["profiles"]["dad"]["stats"] = {"games": 2, "family": {"win": 1, "lose": 1}}
    old6["profiles"]["aunt"]["name"] = "Auntie"
    tctx, t = mk(old6)
    t.goto(base + "?fast=1&fam=0"); t.wait_for_timeout(300)
    check(ev(t, "d.order.join(',')") == "kid,dad,aunt", f"안 쓴 기본 프로필만 치움 (판을 한 아빠 · 이름을 바꾼 고모는 그대로) → {ev(t, 'd.order.join(",")')}")
    t.reload(); t.wait_for_timeout(300)
    check(ev(t, "d.order.length") == 3, "치우기는 한 번만")
    tctx.close()

    # 가족 대결: 팀 = 프로필, 상자·잡은 포켓몬은 그 팀 프로필에
    cctx, c = mk({"settings": {"study": False}})
    c.goto(base + "?fast=1&seed=2&spots=3:133&catch=1&force=3"); c.wait_for_timeout(300)
    c.click("[data-act=new-family]")
    check(len(c.query_selector_all("[data-act=set][data-field=t0].prof-chip")) == 6 and c.query_selector("[data-act=prof-new][data-field=t0]") is not None, "가족 대결 준비: 팀을 프로필로 고르기 (캐릭터 + ➕ 새 프로필)")
    c.click("[data-act=set][data-field=t0][data-value='\"dad\"']"); c.click("[data-act=set][data-field=t1][data-value='\"mom\"']")
    c.click("[data-act=set][data-field=pieces][data-value='2']")
    c.click("[data-act=to-pick]"); c.click("[data-act=pick-auto]"); c.click("#pick-next"); c.click("[data-act=pick-auto]"); c.click("#pick-next")
    wait_idle(c)
    check(ev(c, "JSON.stringify(Y.G.s.teams.map(t => [t.key, t.name, t.avatar]))") == '[["dad","Dad",4],["mom","Mom",1]]', "판의 팀 = 프로필 이름 · 캐릭터")
    check(c.query_selector("#teams .tcard .tn .av") is not None, "팀 카드 이름 옆에 캐릭터")
    c.evaluate("() => { const Y = window.__yut, s = Y.G.s; s.turn = 0; s.phase = 'choose'; s.pending = [3]; s.throwsLeft = 0; Y.Act['skill-cancel'](); }")
    wait_idle(c)
    c.click(".dest[data-move='new/3']", force=True)
    for _ in range(60):
        if c.query_selector(".bt-menu .bt-ballbtn"): c.click(".bt-menu .bt-ballbtn")
        elif c.query_selector(".bt-menu [data-key='later']"): c.click(".bt-menu [data-key='later']")
        elif c.query_selector(".quiz .qz-choice:not([disabled])"): c.click(".quiz .qz-choice")
        elif not ev(c, "Y.G.busy"): break
        c.wait_for_timeout(150)
    check(ev(c, "P.dad.collection.some(x => x.id === 133)") and not ev(c, "P.kid.collection.some(x => x.id === 133)") and ev(c, "P.dad.bag.poke") == 2,
          "풀숲에서 잡은 포켓몬 · 쓴 볼은 그 팀 프로필(아빠)에")
    cctx.close()
    fdb.stop()

def scenario_land(browser, base, errors):
    """안드로이드 가로 화면(주소창·버튼줄 때문에 낮음): 윷 멍석이 늘 보이고, 패널이 위쪽 줄을 덮지 않음 (2026-10-02 사용자 제보: 가로에서 윷이 안 보임)."""
    for vw, vh in ((740, 340), (800, 360), (915, 380), (818, 757), (884, 700), (952, 628), (1024, 560), (1180, 650), (1280, 690)):
        ctx = browser.new_context(viewport={"width": vw, "height": vh}, has_touch=True, is_mobile=True)
        ctx.add_init_script("localStorage.setItem('engmon_yut_en_v1', JSON.stringify({ settings: { study: false } }));")
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
        page.goto(base + "?fast=1&seed=2&spots=none&first=0&force=4,2"); page.wait_for_timeout(300)
        page.click("[data-act=new-family]"); page.click("[data-act=set][data-field=pieces][data-value='4']")
        page.click("[data-act=to-pick]"); page.click("[data-act=pick-auto]"); page.click("#pick-next"); page.click("[data-act=pick-auto]"); page.click("#pick-next")
        wait_idle(page)
        r = page.evaluate("""() => { const m = document.querySelector('.mat').getBoundingClientRect(), p = document.querySelector('.panel').getBoundingClientRect(),
            b = document.querySelector('.game .bar').getBoundingClientRect(), t = document.querySelector('#btn-throw').getBoundingClientRect();
          return { mat: m.height > 30 && m.top >= 0 && m.bottom <= innerHeight + 1, bar: p.top >= b.bottom - 1, thr: t.height >= 44 && t.bottom <= innerHeight + 1 }; }""")
        check(r["mat"] and r["bar"] and r["thr"], f"📱 가로 {vw}x{vh}: 윷 멍석 보임 · 던지기 버튼 보임 · 위쪽 줄 안 덮음 {r}")
        # 던질 때마다 멍석이 위아래로 움직이지 않음 (남은 결과 · 안내 글이 늘어도) — 사용자 제보 2026-10-03
        top = lambda: page.evaluate("() => Math.round(document.querySelector('.mat').getBoundingClientRect().top)")
        tops = [top()]
        for _ in range(2):
            page.click("#btn-throw"); wait_idle(page); page.wait_for_timeout(150); tops.append(top())
        check(max(tops) - min(tops) <= 2, f"📱 가로 {vw}x{vh}: 윷(윷 → 개) 두 번 던져도 멍석 자리 그대로 {tops}")
        # 던지기 버튼 글이 버튼 밖으로 안 나감 (폴드처럼 좁은 가로 · 로켓단 차례 글이 길 때)
        page.evaluate("() => { const Y = window.__yut, s = Y.G.s; s.phase = 'choose'; s.turn = 1; s.pending = [4, 2]; s.throwsLeft = 0; Y.Act['skill-cancel'](); }")
        page.wait_for_timeout(200)
        fit = page.evaluate("() => { const b = document.querySelector('#btn-throw'); return [b.textContent, b.scrollWidth <= b.clientWidth + 1]; }")
        check(fit[1], f"📱 가로 {vw}x{vh}: 던지기 버튼 글이 버튼 안에 ({fit[0]})")
        if (vw, vh) == (800, 360):
            page.screenshot(path=str(OUT / "60-land-phone.png"))
        ctx.close()


def scenario_net(browser, base, errors):
    """v7: 🏠 친구 대결 — 가짜 Firebase + 브라우저 창 두 개로 방 만들기 → 코드로 들어가기 → 고르기 → 번갈아 두기 → 끝(각자 상자)."""
    sys.path.insert(0, str(ROOT / "tools"))
    from fake_firebase import FakeFirebase
    live = "--live-net" in sys.argv  # 실제 주소 + 실제 Firebase 로
    fdb = None if live else FakeFirebase()
    dburl = "" if live else fdb.start()
    if live:
        base = "https://ian939.github.io/pokemon-yut-en/index.html"
    q = "?fast=1&seed=5&spots=3:133,12:25&catch=1" + ("&v=%d" % int(time.time()) if live else "&db=" + dburl)

    def mk(save):
        ctx = browser.new_context(viewport={"width": 1180, "height": 820}, has_touch=True)
        ctx.add_init_script("if (!localStorage.getItem('engmon_yut_en_v1')) localStorage.setItem('engmon_yut_en_v1', " + json.dumps(json.dumps(save)) + ");")
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
        page.on("console", lambda m: errors.append("console: " + m.text) if m.type == "error" and "ERR_" not in m.text else None)
        return ctx, page

    ev = lambda page, js: page.evaluate("() => { const Y = window.__yut, G = Y.G, s = G.s, d = Y.Store.data; return " + js + "; }")
    hctx, host = mk({"settings": {"study": False}})
    gctx, guest = mk({"settings": {"study": False}, "bag": {"poke": 3, "great": 0, "ultra": 0, "luxury": 0, "master": 0}})

    # 방 만들기
    host.goto(base + q); host.wait_for_timeout(300)
    host.click("[data-act=new-net]"); host.click("[data-act=net-host]")
    host.click("[data-act=set][data-field=pieces][data-value='2']")
    check(len(host.query_selector_all("[data-act=set][data-field=timer]")) == 3 and host.query_selector("[data-act=set][data-field=timer][data-value='20'].on") is not None, "⏱ 방 만들기에 차례 타이머 20초 · 10초 · 없음 (처음엔 20초)")
    host.click("[data-act=net-create]")
    host.wait_for_selector(".net-code b", timeout=10000)
    code = "".join(host.eval_on_selector_all(".net-code b", "e => e.map(x => x.textContent)"))
    check(len(code) == 4 and code.isdigit(), f"🏠 방 만들기 → 코드 4자리 ({code})")
    host.screenshot(path=str(OUT / "n1-room.png"))
    measure(host, "🏠 방 코드 화면")

    # 코드로 들어가기 — 틀린 코드 → 맞는 코드
    guest.goto(base + q); guest.wait_for_timeout(300)
    guest.click("[data-act=new-net]"); guest.click("[data-act=net-join]")
    wrong = "0000" if code != "0000" else "1111"
    for d in wrong: guest.click(f"[data-act=net-key][data-k='{d}']")
    # 👤 들어갈 때 내 프로필 고르기 — 새 프로필 "하윤이네" 만들기
    guest.click("[data-act=prof-new][data-field=join]")
    guest.wait_for_selector("#prof-name")
    guest.fill("#prof-name", "하윤이네"); guest.click(".av-pick[data-id='4']"); guest.click("[data-act=prof-ok]")
    guest.wait_for_selector("#net-prof .prof-chip.on", timeout=5000)
    check("하윤이네" in guest.inner_text("#net-prof .prof-chip.on") and "".join(guest.eval_on_selector_all("#net-in b", "e => e.map(x => x.textContent)")) == wrong,
          "👤 코드로 들어가기: 새 프로필을 만들면 바로 골라짐 (누른 코드는 그대로)")
    guest.click("#net-go")
    guest.wait_for_function("() => document.querySelector('#net-err').textContent.length > 0", timeout=10000)
    check("no room" in guest.inner_text("#net-err"), "없는 코드면 '그런 방이 없어요'")
    for _ in range(4): guest.click("[data-act=net-key][data-k='del']")
    for d in code: guest.click(f"[data-act=net-key][data-k='{d}']")
    measure(guest, "🔢 코드 숫자판")
    guest.screenshot(path=str(OUT / "n2-join.png"))
    guest.click("#net-go")
    # 방 만든 집: 친구가 들어오면 고르기
    host.wait_for_selector(".pcard", timeout=15000)
    check("Dreamer" in host.inner_text(".bar h2"), "친구가 들어오면 방 만든 집부터 포켓몬 고르기")
    host.click("[data-act=pick-auto]"); host.click("#pick-next")
    guest.wait_for_selector(".pcard", timeout=15000)
    taken = len(guest.query_selector_all(".pcard.taken"))
    check("하윤이네" in guest.inner_text(".bar h2") and taken >= 1, f"친구네 고르기 — 방 만든 집 포켓몬은 찜 ({taken}마리)")
    guest.click("[data-act=pick-auto]"); guest.click("#pick-next")
    for pg in (host, guest):
        pg.wait_for_function("() => window.__yut.G.s && window.__yut.G.s.settings.mode === 'net' && document.querySelector('.screen.game')", timeout=20000)
        wait_idle(pg, 30000)
    names = ev(host, "s.teams.map(t => t.name).join(' vs ')")
    check("하윤이네" in names and ev(guest, "s.teams.map(t => t.name).join(' vs ')") == names, f"두 패드가 같은 판 ({names})")
    check(ev(host, "G.net.me") == 0 and ev(guest, "G.net.me") == 1, "방 만든 집 = 빨강 팀, 친구네 = 파랑 팀")
    # 🏠 방 번호 왼쪽 위 + 잘못 나가도 코드로 다시 들어가기 (사용자 요청 2026-10-10)
    check(code in host.inner_text(".room-chip") and code in guest.inner_text(".room-chip"), f"게임 화면 왼쪽 위에 방 번호 ({code})")
    if not live:
        before = ev(host, "JSON.stringify(s.pieces)")
        guest.click("[data-act=pause]")
        check(code in guest.inner_text(".room-note"), "쉬기 창에도 방 번호 + 다시 들어오는 방법")
        guest.click("[data-act=pause-giveup]"); guest.fill("#confirm-in", "quit"); guest.click("#confirm-yes")
        guest.wait_for_selector("[data-act=new-net]", timeout=10000)
        guest.click("[data-act=new-net]"); guest.click("[data-act=net-join]")
        for _ in range(4): guest.click("[data-act=net-key][data-k='del']")
        for d in code: guest.click(f"[data-act=net-key][data-k='{d}']")
        guest.click("#net-go")
        guest.wait_for_function("() => window.__yut.G.s && window.__yut.G.net && document.querySelector('.screen.game')", timeout=15000)
        wait_idle(guest, 30000)
        check(ev(guest, "G.net.me") == 1 and ev(guest, "JSON.stringify(s.pieces)") == before, "그만둬도 같은 코드로 들어가면 같은 판·내 자리(파랑)로 다시")
        # 다른 패드(기록 없음)에서 들어가면 누구인지 고르기
        nctx, newp = mk({"settings": {"study": False}})
        newp.goto(base + q); newp.wait_for_timeout(300)
        newp.click("[data-act=new-net]"); newp.click("[data-act=net-join]")
        for d in code: newp.click(f"[data-act=net-key][data-k='{d}']")
        newp.click("#net-go")
        newp.wait_for_selector("[data-act=net-rejoin]", timeout=10000)
        btns = newp.eval_on_selector_all("[data-act=net-rejoin]", "e => e.map(x => x.textContent)")
        check(len(btns) == 2 and "하윤이네" in btns[1], f"기록 없는 패드: 'Which one are you?' 두 이름 ({btns})")
        newp.click("[data-act=net-rejoin][data-i='1']")
        newp.wait_for_function("() => window.__yut.G.net && window.__yut.G.net.me === 1 && document.querySelector('.screen.game')", timeout=15000)
        check(True, "고른 자리로 같은 판에 들어감")
        nctx.close()
    host.screenshot(path=str(OUT / "n3-host-game.png"))
    guest.screenshot(path=str(OUT / "n3-guest-game.png"))

    # 💬 감정 표현 — 피카츄 표정 5가지, 상대 패드 팀 카드 모서리에
    check(host.query_selector("#emote-btn") is not None and guest.query_selector("#emote-btn") is not None, "친구 대결에 💬 감정 버튼")
    host.click("#emote-btn")
    host.wait_for_selector(".emote-pick .emo", timeout=5000)
    check(len(host.query_selector_all(".emote-pick .emo")) == 5, "감정 5가지 (좋아·우와·아쉬워·두고 봐·잘했어)")
    host.wait_for_timeout(400)
    measure(host, "💬 감정 고르기")
    host.screenshot(path=str(OUT / "n5-emote-pick.png"))
    host.click(".emote-pick .emo[data-k='good']")
    guest.wait_for_selector(".emote-pop[data-team='0']", timeout=15000)
    check("Good job" in guest.inner_text(".emote-pop[data-team='0']"), "친구네 패드에 '👍 잘했어!' (방 만든 집 카드 옆)")
    guest.screenshot(path=str(OUT / "n6-emote-pop.png"))
    check(host.query_selector("#emote-btn").is_disabled(), "보낸 뒤 3초는 쉬기 (도배 막기)")
    host.wait_for_timeout(3200)
    check(not host.query_selector("#emote-btn").is_disabled(), "3초 뒤 다시 보낼 수 있음")
    guest.click("#emote-btn"); guest.click(".emote-pick .emo[data-k='huff']")
    host.wait_for_selector(".emote-pop[data-team='1']", timeout=15000)
    check("Just wait" in host.inner_text(".emote-pop[data-team='1']"), "방 만든 집 패드에 '😤 두고 봐!'")
    same = False
    for _ in range(40):  # ⏱ 타이머가 그사이 저절로 둘 수 있어서 두 패드가 맞춰질 때까지
        if ev(host, "G.net.seq") == ev(guest, "G.net.seq") and not ev(host, "G.busy") and not ev(guest, "G.busy"):
            same = True; break
        host.wait_for_timeout(250)
    check(same and ev(host, "s.pieces.length") == ev(guest, "s.pieces.length"), "감정 표현은 판 동기화에 영향 없음")

    # ⏱ 차례 타이머: 가만히 있으면 저절로 던진다
    check(ev(host, "s.settings.timer") == 20 and ev(guest, "s.settings.timer") == 20, "두 패드 모두 차례 타이머 20초")
    turn_pg = host if ev(host, "s.turn") == 0 else guest
    seq0 = ev(turn_pg, "G.net.seq")
    try:
        turn_pg.wait_for_selector("#turn-timer:not([hidden])", timeout=8000)
        seen = turn_pg.inner_text("#turn-timer")
    except Exception:
        seen = ""
    check("⏱" in seen, f"내 차례에 ⏱ 남은 초 ({seen})")
    turn_pg.wait_for_function(f"() => window.__yut.G.net.seq > {seq0}", timeout=15000)
    check(True, "시간이 다 되면 저절로 던짐")
    wait_idle(turn_pg, 30000)

    # 번갈아 두기 — 차례인 패드만 움직인다
    bag0 = {id(host): sum(ev(host, "Object.values(d.bag)")), id(guest): sum(ev(guest, "Object.values(d.bag)"))}
    same_checks, steps, wrong_turn = 0, 0, 0
    ball_menu = [0]
    def act(pg):
        try:
            return act0(pg)
        except Exception:
            return False  # 연출 중에 버튼이 사라지면 다음 번에
    def act0(pg):
        if pg.query_selector(".quiz .qz-choice:not([disabled])"): pg.click(".quiz .qz-choice"); return True
        if pg.query_selector(".quiz .qz-next:not([hidden])"): pg.click(".quiz .qz-next"); return True
        if pg.query_selector(".modal .gift-pick"): pg.click(".modal .gift-pick"); return True
        if pg.query_selector(".bt-menu [data-key='later']"): pg.click(".bt-menu [data-key='later']"); return True
        if pg.query_selector(".bt-menu .bt-ballbtn"): ball_menu[0] += 1; pg.click(".bt-menu .bt-ballbtn"); return True
        sk = pg.query_selector(".bt-skip")
        if sk: sk.click(force=True); return True
        st = pg.evaluate("() => { const Y = window.__yut, G = Y.G; if (!G.s) return null; const mine = G.s.turn === G.net.me; return { phase: G.s.phase, mine, human: !!(G.s && !G.s.teams[G.s.turn].cpu && G.s.turn === G.net.me && !G.net.remoteBusy), busy: G.busy, over: !!document.querySelector('.win-screen'), dests: document.querySelectorAll('.dest:not(.cpu)').length }; }")
        if not st or st["over"] or st["busy"] or not st["human"]: return False
        if st["phase"] == "throw":
            pg.click("#btn-throw", force=True); return True
        if st["phase"] == "choose":
            if st["dests"] == 0:
                t = pg.query_selector(".unit.can") or pg.query_selector(".pchip.can")
                if t: t.click(); pg.wait_for_timeout(40)
            ds = pg.query_selector_all(".dest:not(.cpu)")
            if ds: ds[-1].click(force=True); return True
        return False
    for step in range(900):
        if host.query_selector(".win-screen") and guest.query_selector(".win-screen"): break
        moved = act(host) or act(guest)
        if moved: steps += 1
        # 차례가 아닌 패드의 던지기 버튼은 꺼져 있어야 한다
        for pg in (host, guest):
            r = pg.evaluate("() => { const G = window.__yut.G; const b = document.querySelector('#btn-throw'); return G.s && G.s.phase === 'throw' && G.s.turn !== G.net.me && b && !b.disabled; }")
            if r: wrong_turn += 1
        if step % 25 == 10:
            a = host.evaluate("() => { const G = window.__yut.G; return !G.busy && !G.net.running && !G.net.remoteBusy && !G.net.queue.length ? JSON.stringify(G.s.pieces.map(p => [p.state, p.route, p.step, p.stage])) + G.s.turn : null; }")
            b = guest.evaluate("() => { const G = window.__yut.G; return !G.busy && !G.net.running && !G.net.remoteBusy && !G.net.queue.length ? JSON.stringify(G.s.pieces.map(p => [p.state, p.route, p.step, p.stage])) + G.s.turn : null; }")
            if a and b:
                if a == b: same_checks += 1
                else:
                    host.wait_for_timeout(1500)
                    a = host.evaluate("() => JSON.stringify(window.__yut.G.s.pieces.map(p => [p.state, p.route, p.step, p.stage])) + window.__yut.G.s.turn")
                    b = guest.evaluate("() => JSON.stringify(window.__yut.G.s.pieces.map(p => [p.state, p.route, p.step, p.stage])) + window.__yut.G.s.turn")
                    if a == b: same_checks += 1
                    else: check(False, f"두 패드의 판이 다름 {a} / {b}")
        if not moved: host.wait_for_timeout(60)
    over = bool(host.query_selector(".win-screen")) and bool(guest.query_selector(".win-screen"))
    check(over, f"친구 대결 한 판을 끝까지 (동작 {steps}번)")
    check(wrong_turn == 0, "차례가 아닌 패드는 던지기 버튼이 꺼져 있음")
    host.wait_for_timeout(800)
    fin = [pg.evaluate("() => JSON.stringify(window.__yut.G.s.pieces.map(p => [p.state, p.stage])) + window.__yut.G.s.winner") for pg in (host, guest)]
    check(fin[0] == fin[1], f"끝난 판이 두 패드에서 똑같음 (중간 확인 {same_checks}번, 다른 적 없음)")
    if over:
        w = ev(host, "s.winner")
        check(ev(guest, "s.winner") == w, "두 패드의 이긴 팀이 같음")
        hb, gb = sum(ev(host, "Object.values(d.bag)")), sum(ev(guest, "Object.values(d.bag)"))
        hwin, gwin = w == 0, w == 1
        check((hb - bag0[id(host)]) == (3 if hwin else 1) and (gb - bag0[id(guest)]) == (3 if gwin else 1), f"각자 패드에 보상 — 이긴 집 볼 3개 · 진 집 1개 (방 만든 집 +{hb - bag0[id(host)]} · 친구네 +{gb - bag0[id(guest)]})")
        check(host.query_selector("[data-act=rematch]") is None, "친구 대결 끝 화면엔 로켓단·가족용 '한 판 더' 대신 같은 친구와 한 판 더")
        host.screenshot(path=str(OUT / "n4-host-win.png"))
        guest.screenshot(path=str(OUT / "n4-guest-win.png"))
        check(ev(host, "d.net") is None and ev(guest, "d.net") is None, "끝난 친구 대결은 이어하기에서 빠짐")
        allseen = "Object.values(d.profiles).reduce((t, p) => t + (p.stats.wildSeen || 0), 0)"
        seen_w = ev(host, allseen) + ev(guest, allseen)
        allcol = "Object.values(d.profiles).reduce((t, p) => t + p.collection.length, 0)"
        got_w = ev(host, allcol) + ev(guest, allcol)
        check(ball_menu[0] == 0 and (seen_w == 0 or got_w >= 1), f"🌿 친구 대결 풀숲: 볼 고르기 없이 저절로 던짐 (조우 {seen_w}번 · 잡음 {got_w}마리)")

        # 🔁 같은 친구와 한 판 더 — 같은 방에서 바로, 이번엔 친구네가 먼저 고른다
        host.click(".win-screen .chest", force=True)
        host.wait_for_selector(".win-btns:not(.hidden) [data-act=net-rematch]", timeout=20000)
        check("Rematch" in host.inner_text("[data-act=net-rematch]"), "친구 대결 끝 화면에 '🔁 같은 친구와 한 판 더'")
        host.click("[data-act=net-rematch]")
        guest.wait_for_selector(".pcard", timeout=20000)
        host.wait_for_selector(".net-wait", timeout=20000)
        check("하윤이네" in guest.inner_text(".bar h2") and "first" in host.inner_text(".net-wait"), "한 판 더: 고르는 순서가 바뀜 (이번엔 친구네 먼저, 방 만든 집은 기다림)")
        guest.click("[data-act=pick-auto]"); guest.click("#pick-next")
        host.wait_for_selector(".pcard", timeout=20000)
        taken2 = len(host.query_selector_all(".pcard.taken"))
        check(taken2 >= 1, f"방 만든 집 고르기 — 친구네 포켓몬은 찜 ({taken2}마리)")
        host.click("[data-act=pick-auto]"); host.click("#pick-next")
        for pg in (host, guest):
            pg.wait_for_function("() => window.__yut.G.s && window.__yut.G.s.settings.mode === 'net' && window.__yut.G.s.phase !== 'over' && document.querySelector('.screen.game')", timeout=30000)
            wait_idle(pg, 30000)
        same = host.evaluate("() => JSON.stringify(window.__yut.G.s.teams.map(t => t.picks))") == guest.evaluate("() => JSON.stringify(window.__yut.G.s.teams.map(t => t.picks))")
        check(same and ev(host, "G.net.round") == 1 and ev(guest, "G.net.round") == 1 and ev(host, "G.net.code") == code,
              f"한 판 더: 같은 방(코드 {code})에서 두 패드가 같은 새 판 (2판째)")
    hctx.close(); gctx.close()

    # 이어하기: 판 도중에 친구네 패드를 새로고침 → 같은 판으로
    hctx, host = mk({"settings": {"study": False}})
    gctx, guest = mk({"settings": {"study": False}})
    host.goto(base + q); host.wait_for_timeout(300)
    host.click("[data-act=new-net]"); host.click("[data-act=net-host]")
    host.click("[data-act=set][data-field=pieces][data-value='2']"); host.click("[data-act=net-create]")
    host.wait_for_selector(".net-code b", timeout=10000)
    code = "".join(host.eval_on_selector_all(".net-code b", "e => e.map(x => x.textContent)"))
    guest.goto(base + q); guest.wait_for_timeout(300)
    guest.click("[data-act=new-net]"); guest.click("[data-act=net-join]")
    for d in code: guest.click(f"[data-act=net-key][data-k='{d}']")
    guest.click("[data-act=prof-new][data-field=join]"); guest.wait_for_selector("#prof-name")
    guest.fill("#prof-name", "하윤이네"); guest.click("[data-act=prof-ok]"); guest.wait_for_selector("#net-prof .prof-chip.on")
    guest.click("#net-go")
    host.wait_for_selector(".pcard", timeout=15000); host.click("[data-act=pick-auto]"); host.click("#pick-next")
    guest.wait_for_selector(".pcard", timeout=15000); guest.click("[data-act=pick-auto]"); guest.click("#pick-next")
    for pg in (host, guest):
        pg.wait_for_function("() => document.querySelector('.screen.game') && window.__yut.G.s", timeout=20000); wait_idle(pg, 30000)
    for k in range(6):
        if not (act(host) or act(guest)): host.wait_for_timeout(200)
    guest.reload(); guest.wait_for_timeout(500)
    check(guest.query_selector("[data-act=resume]") is not None and "Friend Battle" in guest.inner_text("[data-act=resume]"), "새로고침하면 '🏠 친구 대결 이어하기'")
    guest.click("[data-act=resume]"); wait_idle(guest, 30000)
    guest.wait_for_timeout(1500)
    for k in range(8):
        if not (act(host) or act(guest)): host.wait_for_timeout(250)
    snap = "() => { const G = window.__yut.G; return G.busy || G.net.running || G.net.remoteBusy || G.net.queue.length ? null : JSON.stringify(G.s.pieces.map(p => [p.state, p.step])) + G.s.turn + '/' + G.net.seq; }"
    a = b = None
    for _ in range(60):  # ⏱ 타이머가 저절로 둘 수 있어서 두 패드가 쉬고 있을 때 비교
        host.wait_for_timeout(250)
        a, b = host.evaluate(snap), guest.evaluate(snap)
        if a and a == b: break
    check(a is not None and a == b, "이어한 뒤에도 두 패드의 판이 같음")
    hctx.close(); gctx.close()
    if fdb: fdb.stop()


def main():
    httpd = serve()
    base = f"http://127.0.0.1:{httpd.server_port}/index.html"
    print("서버:", base)
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        if not any(f in sys.argv for f in ("--v2-only", "--v3-only", "--v4-only", "--net-only", "--live-net", "--v8-only")):
            scenario(browser, base, errors)
        if not any(f in sys.argv for f in ("--v3-only", "--v4-only", "--net-only", "--live-net", "--v8-only")):
            scenario_v2(browser, base, errors)
        if not any(f in sys.argv for f in ("--v4-only", "--net-only", "--live-net", "--v8-only")):
            scenario_v3(browser, base, errors)
        if "--net-only" not in sys.argv and "--live-net" not in sys.argv and "--v8-only" not in sys.argv:
            scenario_v4(browser, base, errors)
        if "--net-only" not in sys.argv and "--live-net" not in sys.argv:
            scenario_v8(browser, base, errors)
        if "--v8-only" in sys.argv:
            browser.close()
            check(not errors, "콘솔 오류 없음" + ("" if not errors else " → " + " | ".join(errors[:5])))
            httpd.shutdown()
            sys.exit(1 if fails else 0)
        if "--live-net" not in sys.argv:
            scenario_land(browser, base, errors)
        scenario_net(browser, base, errors)
        if "--live-net" not in sys.argv:
            scenario_save(browser, base, errors)
        if any(f in sys.argv for f in ("--scenario-only", "--v2-only", "--v3-only", "--v4-only", "--net-only", "--live-net")):
            browser.close()
            check(not errors, "콘솔 오류 없음" + ("" if not errors else " → " + " | ".join(errors[:5])))
            httpd.shutdown()
            sys.exit(1 if fails else 0)

        # ---------- 1. 가족 대결 (가로 패드) ----------
        ctx = browser.new_context(viewport={"width": 1180, "height": 820}, device_scale_factor=1, has_touch=True)
        ctx.add_init_script("if (!localStorage.getItem('engmon_yut_en_v1')) localStorage.setItem('engmon_yut_en_v1', " + json.dumps(YUT_SAVE) + ");")
        page = ctx.new_page()
        page.on("console", lambda m: errors.append("console: " + m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
        page.add_init_script("""
          window.__ev = [];
          window.addEventListener('load', () => {
            const o = Yut.applyMove, t = Yut.applyThrow;
            Yut.applyMove = function () { const r = o.apply(this, arguments); r.events.forEach(e => window.__ev.push(e.type)); return r; };
            Yut.applyThrow = function () { const r = t.apply(this, arguments); r.events.forEach(e => window.__ev.push(e.type)); return r; };
          });
        """)
        page.goto(base + "?fast=1&seed=12")
        page.wait_for_timeout(600)
        page.screenshot(path=str(OUT / "01-home.png"))
        measure(page, "처음 화면")
        page.click("[data-act=new-family]")
        page.screenshot(path=str(OUT / "02-setup.png"))
        measure(page, "준비 화면")
        page.click("[data-act=to-pick]")
        page.wait_for_timeout(300)
        page.screenshot(path=str(OUT / "03-pick-empty.png"))
        grids = page.eval_on_selector_all("#pick-scroll .grid", "gs => gs.map(g => [...g.querySelectorAll('.pcard')].map(c => +c.dataset.id))")
        check(len(grids) == 2 and len(grids[0]) == 27 and grids[0][:3] == [1, 4, 7], f"명단: 스타팅 포켓몬 27마리 ({len(grids[0]) if grids else 0}마리)")
        check(len(grids) == 2 and grids[1] == [5, 58, 133], f"명단: 잡은 포켓몬이 잡은 순서대로 뒤에 (리자드 → 가디 → 이브이: {grids[1] if len(grids) > 1 else None})")
        page.click("[data-act=pick-auto]")
        page.wait_for_timeout(200)
        page.screenshot(path=str(OUT / "04-pick-team1.png"))
        measure(page, "고르기 화면")
        page.click("#pick-next")
        page.wait_for_timeout(200)
        t1 = page.evaluate("() => window.__yut.Setup.picks[0]")
        # 👤 두 번째 팀은 그 사람의 포켓몬만 보인다 (첫 팀이 고른 잡은 포켓몬은 없을 수도) — 보이는 것은 찜
        ok_taken = page.evaluate("(ids) => ids.every(id => { const c = document.querySelector('.pcard[data-id=\"' + id + '\"]'); return !c || c.classList.contains('taken'); })", t1)
        check(ok_taken, "두 번째 팀 화면에서 첫 팀 포켓몬(과 같은 진화 가족)은 못 고름")
        check(page.query_selector(".pcard[data-id='133']") is None, "👤 두 번째 팀(엄마) 명단엔 지온이가 잡은 포켓몬이 없음")
        # 같은 가족 두 마리 막기: 스타팅 파이리(4)와 잡은 리자드(5)
        page.goto(base + "?fast=1&seed=12"); page.wait_for_timeout(300)
        page.click("[data-act=new-family]"); page.click("[data-act=to-pick]")
        page.evaluate("() => { window.__yut.Setup.picks[0] = []; }")
        page.click(".pcard[data-id='4']")
        page.click(".pcard[data-id='5']", force=True)
        n2 = page.evaluate("() => window.__yut.Setup.picks[0]")
        check(n2 == [4], f"같은 진화 가족은 한 팀에 한 마리만 (파이리·리자드 → {n2})")
        page.click("[data-act=pick-auto]"); page.click("#pick-next")
        page.click("[data-act=pick-auto]")
        page.screenshot(path=str(OUT / "05-pick-team2.png"))
        page.click("#pick-next")
        page.wait_for_timeout(200)
        page.screenshot(path=str(OUT / "06-game-start.png"))
        # 고르기 화면의 "파이리 가족은 벌써 골랐어요!" 알림이 윷판 안내 칸을 덮으면 안 된다
        check(not page.evaluate("() => document.querySelector('#toast').classList.contains('show')"),
              "앞 화면 알림은 윷판으로 넘어오면 사라짐 (안내 칸을 덮지 않음)")
        wait_idle(page)
        page.screenshot(path=str(OUT / "07-game-ready.png"))
        measure(page, "윷판 화면(가로)")
        done = play_to_end(page, "10-family")
        check(done, "가족 대결 한 판을 끝까지 둠")
        page.wait_for_timeout(700)
        page.screenshot(path=str(OUT / "19-family-win.png"))
        ev = page.evaluate("() => window.__ev")
        for t in ("throw", "move", "turn", "evolve", "finish", "win"):
            check(t in ev, f"이벤트 '{t}' 나옴 ({ev.count(t)}번)")
        print("   (그 밖에: 잡기 %d · 업기 %d · 쉬어 가기 %d · 배틀 건너뛰기 %d)" % (ev.count("capture"), ev.count("stack"), ev.count("skip"), SKIPS[0]))
        stats = page.evaluate("() => window.__yut.Store.data.stats")
        check(stats["games"] == 1, "전적 1판 기록")
        check(page.evaluate("() => window.__yut.Store.data.game") is None, "끝난 판은 이어하기에서 빠짐")

        # ---------- 3. 이어하기 ----------
        page.click("[data-act=rematch]")
        wait_idle(page)
        for _ in range(4):
            if page.evaluate("() => window.__yut.G.s.phase") == "throw" and not page.evaluate("() => window.__yut.G.s.teams[window.__yut.G.s.turn].cpu"):
                page.click("#btn-throw", force=True)
                wait_idle(page)
            d = page.query_selector(".dest:not(.cpu)")
            if d:
                d.click(force=True)
                wait_idle(page)
        before = page.evaluate("() => JSON.stringify(window.__yut.G.s.pieces) + window.__yut.G.s.turn + window.__yut.G.s.phase")
        page.reload()
        page.wait_for_timeout(500)
        check(page.query_selector("[data-act=resume]") is not None, "새로고침 뒤 처음 화면에 '이어하기'")
        page.click("[data-act=resume]")
        wait_idle(page)
        after = page.evaluate("() => JSON.stringify(window.__yut.G.s.pieces) + window.__yut.G.s.turn + window.__yut.G.s.phase")
        check(before == after, "이어하기: 말 위치·차례·단계가 그대로")

        # ---------- 5. 새 버전 감지 ----------
        html = (ROOT / "index.html").read_text(encoding="utf-8")
        newer = re.sub(r'APP_VERSION = "[^"]+"', 'APP_VERSION = "2099-01-01z"', html)
        page.route(re.compile(r".*/index\.html\?v=\d+$"), lambda route: route.fulfill(status=200, body=newer, content_type="text/html; charset=utf-8"))
        page.goto(base + "?fast=1")
        page.wait_for_timeout(1200)
        check(page.query_selector("text=🎁 New version!") is not None, "서버 파일이 새 버전이면 알림이 뜸")
        page.screenshot(path=str(OUT / "20-update.png"))
        page.click("[data-act=close-modal]")
        check(page.query_selector("#upd-btn") is not None and "new v" in page.inner_text(".ver"), "'나중에' 해도 처음 화면에 🎁 새 버전으로 바꾸기 버튼이 남음")
        # 판 중에는 알림 창을 띄우지 않고, 처음 화면으로 오면 알려 줌 (탭을 계속 열어 둔 패드)
        page.evaluate("() => { Update.ver = null; Update.told = null; }")
        page.click("[data-act=new-family]"); page.click("[data-act=to-pick]"); page.click("[data-act=pick-auto]"); page.click("#pick-next"); page.click("[data-act=pick-auto]"); page.click("#pick-next")
        wait_idle(page)
        page.evaluate("() => checkUpdate(true)"); page.wait_for_timeout(800)
        check(page.query_selector("text=🎁 New version!") is None, "판 중에는 새 버전 알림 창이 안 뜸 (놀이 방해 안 함)")
        page.click("[data-act=pause]"); page.click("[data-act=pause-home]"); page.wait_for_timeout(800)
        check(page.query_selector("text=🎁 New version!") is not None, "판을 나와 처음 화면에 오면 새 버전 알림")
        page.unroute(re.compile(r".*/index\.html\?v=\d+$"))
        ctx.close()

        # ---------- 2. 로켓단 대결 (세로 패드) ----------
        ctx = browser.new_context(viewport={"width": 820, "height": 1180}, has_touch=True)
        page = ctx.new_page()
        page.on("console", lambda m: errors.append("console: " + m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
        page.goto(base + "?fast=1&seed=7")
        page.wait_for_timeout(400)
        page.screenshot(path=str(OUT / "30-home-portrait.png"))
        page.click("[data-act=new-rocket]")
        page.click("[data-act=set][data-field=cpu][data-value='\"normal\"']")
        page.click("[data-act=to-pick]")
        page.click("[data-act=pick-auto]")
        page.click("#pick-next")
        page.wait_for_timeout(500)
        page.screenshot(path=str(OUT / "31-rocket-intro.png"))
        check(page.query_selector(".rocket-intro") is not None, "로켓단 등장 연출")
        page.click("#ri-go")
        wait_idle(page)
        page.screenshot(path=str(OUT / "32-rocket-game.png"))
        measure(page, "윷판 화면(세로)")
        done = play_to_end(page, "33-rocket")
        check(done, "로켓단 대결 한 판을 끝까지 둠 (컴퓨터가 스스로 둠)")
        page.wait_for_timeout(700)
        page.screenshot(path=str(OUT / "39-rocket-win.png"))
        ctx.close()

        # ---------- 4. 도감 없음 + 폰 ----------
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True, device_scale_factor=2)
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
        page.goto(base + "?fast=1")
        page.wait_for_timeout(400)
        page.screenshot(path=str(OUT / "40-phone-home.png"))
        measure(page, "폰 처음 화면")
        page.click("[data-act=new-family]")
        page.click("[data-act=to-pick]")
        check(page.query_selector(".empty-grid") is not None, "잡은 포켓몬이 없으면 ❓ 풀숲 안내")
        page.screenshot(path=str(OUT / "41-phone-nodex.png"))
        page.click("[data-act=pick-auto]")
        page.click("#pick-next")
        page.click("[data-act=pick-auto]")
        page.click("#pick-next")
        wait_idle(page)
        page.screenshot(path=str(OUT / "42-phone-game.png"))
        measure(page, "폰 윷판 화면")
        ctx.close()
        browser.close()

    check(not errors, "콘솔 오류 없음" + ("" if not errors else " → " + " | ".join(errors[:5])))
    httpd.shutdown()
    print("\n스크린샷:", OUT)
    print("실패 %d개" % len(fails) if fails else "전부 통과")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
