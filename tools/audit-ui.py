"""전체 화면 점검: 8가지 화면 크기 × 17장면(처음·창들·준비·고르기·로켓단 등장·윷판·기술·시계·조우·우승·상자·돈 문제)에서
화면 밖으로 나가서 스크롤로도 못 보는 것, 칸에서 잘린 글자, 가로 스크롤을 찾고 스크린샷을 남긴다.

    PYTHONIOENCODING=utf-8 PYTHONUTF8=1 python tools/audit-ui.py [태그] [1180x820,390x844]
"""
import pathlib, sys, json
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parent.parent
SP = ROOT / 'art-src' / 'audit'   # git 제외 폴더
SP.mkdir(parents=True, exist_ok=True)
TAG = sys.argv[1] if len(sys.argv) > 1 else 'a'
url = (ROOT / 'index.html').as_uri()
SIZES = [(1180, 820), (1024, 690), (960, 600), (1280, 720), (820, 1180), (768, 1024), (390, 844), (360, 740)]
if len(sys.argv) > 2: SIZES = [tuple(map(int, x.split('x'))) for x in sys.argv[2].split(',')]

CHECK = """(root) => {
  const out = [];
  const W = innerWidth, H = innerHeight;
  const R = e => e.getBoundingClientRect();
  const vis = e => { const s = getComputedStyle(e); return s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity > 0.05 && R(e).width > 0 && R(e).height > 0; };
  // 1) 겹쳐 뜨는 창: 내용이 화면 밖으로 나가는데 스크롤도 안 되면 잘림
  document.querySelectorAll(root).forEach(box => {
    if (!vis(box)) return;
    const scrollers = [box, ...box.querySelectorAll('*')].filter(e => { const s = getComputedStyle(e); return /(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 1; });
    box.querySelectorAll('button, p, h1, h2, h3, b, span, img, .chest, .ballchip, .btn').forEach(e => {
      if (!vis(e) || e.closest('.spr')) return; // 도트 그림은 칸보다 크게 그려 두고 투명한 가장자리가 넘친다 (보이는 잘림 아님)
      const r = R(e);
      if (r.bottom > H + 1 || r.top < -1 || r.right > W + 1 || r.left < -1) {
        const reach = scrollers.some(s => s.contains(e));
        if (!reach) out.push('화면 밖(스크롤 안 됨): ' + (e.className || e.tagName) + ' "' + (e.textContent || '').trim().slice(0, 16) + '" ' + Math.round(r.top) + '~' + Math.round(r.bottom) + ' / ' + H);
      }
    });
  });
  // 2) 글자가 칸에서 잘림 (말줄임·숨김)
  document.querySelectorAll('body *').forEach(e => {
    if (!vis(e) || !e.childNodes.length) return;
    const s = getComputedStyle(e);
    if (!/(hidden|clip)/.test(s.overflowX) && s.textOverflow !== 'ellipsis') return;
    if (e.matches('.board, .board *, .spr, .spr *, .unit, .unit *, .mat, .mat *, .pchip, .bt-stage, .bt-stage *, .hpbar, .hpbar *, .result-card, .result-card *, .pic, .pi-pic, .si-pic, .mini, .sticks, #app, .screen, .scroll, .qz-card, .modal, .grid-wrap')) return;
    if (e.scrollWidth > e.clientWidth + 2 && (e.textContent || '').trim()) out.push('글자 잘림(가로): ' + e.className + ' "' + e.textContent.trim().slice(0, 20) + '" ' + e.scrollWidth + '>' + e.clientWidth);
    if (/(hidden|clip)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 2 && (e.textContent || '').trim() && !e.matches('.hint')) out.push('글자 잘림(세로): ' + e.className + ' "' + e.textContent.trim().slice(0, 20) + '" ' + e.scrollHeight + '>' + e.clientHeight);
  });
  if (document.documentElement.scrollWidth > W + 1) out.push('가로 스크롤');
  return [...new Set(out)];
}"""

def idle(pg):
    pg.wait_for_function('() => window.__yut && !window.__yut.G.busy', timeout=30000)

report = {}
with sync_playwright() as p:
    b = p.chromium.launch()
    for vw, vh in SIZES:
        key = f'{vw}x{vh}'
        res = report[key] = {}
        def shot(pg, name, root='body'):
            pg.wait_for_timeout(450)
            res[name] = pg.evaluate(CHECK, root)
            pg.screenshot(path=str(SP / f'{TAG}-{key}-{name}.png'))
        pg = b.new_page(viewport={'width': vw, 'height': vh}, has_touch=True)
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.add_init_script("if (!localStorage.getItem('engmon_yut_v1')) localStorage.setItem('engmon_yut_v1', JSON.stringify({ collection: [{id:5,t:1},{id:133,t:2},{id:150,t:3}], bag: {poke:3,great:2,ultra:1,luxury:1,master:1} }));")
        pg.goto(url + '?fast=1&fam=1&seed=2&spots=3:133,12:58&early=1&pools=nitro,surf|toxic,quake&box=master,luxury,ultra&money=0,3,2,5')
        pg.wait_for_timeout(500)
        shot(pg, 'home')
        pg.click('[data-act=help]'); shot(pg, 'rules', '.modal')
        pg.click('[data-act=help-tab][data-tab=dex]'); shot(pg, 'dex', '.modal'); pg.click('[data-act=close-modal]')
        pg.click('[data-act=profiles]'); shot(pg, 'profiles')
        pg.click('[data-act=prof-bag][data-id=kid]'); shot(pg, 'bag', '.modal'); pg.click('[data-act=close-modal]')
        pg.click('[data-act=home]'); pg.click('[data-act=rank]'); pg.wait_for_timeout(600); shot(pg, 'rank')
        pg.click('[data-act=home]')
        pg.click('text=로켓단 대결'); shot(pg, 'setup')
        pg.click("[data-act=set][data-field=pieces][data-value='2']")
        pg.click('[data-act=to-pick]'); pg.click('[data-act=pick-auto]'); shot(pg, 'pick')
        pg.click('#pick-next')
        pg.wait_for_selector('#ri-go'); shot(pg, 'rocket-intro'); pg.click('#ri-go'); idle(pg)
        shot(pg, 'game')
        pg.click('.pchip[data-piece="0"]'); shot(pg, 'piece-info', '.modal'); pg.click('[data-act=close-modal]')
        pg.evaluate("() => { const Y = window.__yut, s = Y.G.s; Object.assign(s.pieces[0], { state: 'board', atGoal: false }, Y.Yut.settle('OUT', 2)); Y.Act['skill-cancel'](); }")
        idle(pg)
        pg.click('#btn-skill'); shot(pg, 'skill-menu', '.modal'); pg.click('[data-act=close-modal]')
        # 시계 문제
        pg.evaluate("() => { const s = window.__yut.G.s; s.spots = [{ node: 3, id: null, used: false }]; s.phase = 'choose'; s.pending = [1]; s.throwsLeft = 0; window.__yut.Act['skill-cancel'](); }")
        idle(pg)
        pg.click('.unit.can', force=True); pg.click(".dest[data-move='n2/1']", force=True)
        pg.wait_for_selector('.quiz .qz-choice'); shot(pg, 'clock', '.quiz')
        pg.click('.qz-choice:not([data-ok])'); pg.wait_for_selector('.qz-next:not([hidden])'); shot(pg, 'clock-explain', '.quiz')
        pg.click('.qz-next'); pg.wait_for_selector('.quiz .qz-choice:not([disabled])'); pg.click('.qz-choice[data-ok]')  # 두 번째 문제
        pg.wait_for_timeout(1200); pg.wait_for_selector('.quiz .qz-choice:not([disabled])', timeout=20000); pg.click('.qz-choice[data-ok]')  # 🕐 세 번째 기회
        pg.wait_for_selector('.bt-menu .bt-ballbtn'); shot(pg, 'wild', '.battle')
        pg.click('.bt-skip'); idle(pg)
        # 이긴 화면 → 상자 → 돈 문제 → 볼 4개
        pg.evaluate("""() => { const Y = window.__yut, s = Y.G.s; Object.assign(s.pieces[0], { state: 'done' });
          Object.assign(s.pieces[1], { state: 'board', route: 'OUT', step: 19, atGoal: false }); s.phase = 'choose'; s.pending = [3]; s.throwsLeft = 0; s.turn = 0; Y.Act['skill-cancel'](); }""")
        idle(pg)
        pg.click('.dest.goal', force=True)
        pg.wait_for_selector('.win-screen .chest', timeout=20000); pg.wait_for_timeout(600); shot(pg, 'win-box', '.win-screen')
        pg.click('.win-screen .chest', force=True)
        pg.wait_for_selector('.quiz .qz-choice', timeout=20000); shot(pg, 'money', '.quiz')
        pg.click('.qz-choice:not([data-ok])'); pg.wait_for_selector('.qz-next:not([hidden])'); shot(pg, 'money-explain', '.quiz')
        pg.click('.qz-next'); pg.wait_for_selector('.quiz .qz-choice:not([disabled])'); pg.click('.qz-choice[data-ok]')
        pg.wait_for_timeout(1200); pg.wait_for_selector('.quiz .qz-choice:not([disabled])', timeout=20000); pg.click('.qz-choice[data-ok]')  # 🏥 세 번째 손님
        pg.wait_for_selector('.center-ov .cv-ball', timeout=20000); shot(pg, 'center-ball', '.center-ov')
        pg.click('.center-ov .cv-ball', force=True); pg.wait_for_selector('.center-ov .cv-mon', timeout=20000); shot(pg, 'center-mon', '.center-ov')
        pg.click('[data-act=center-close]'); pg.wait_for_selector('#bonus-zone .bonus-mon', timeout=20000)
        pg.wait_for_selector('.win-btns:not(.hidden)', timeout=20000); pg.wait_for_timeout(800); shot(pg, 'win-done', '.win-screen')
        res['_errors'] = errs
        pg.close()
    b.close()
bad = 0
for k, v in report.items():
    for name, issues in v.items():
        if issues:
            bad += 1
            print(k, name, '→', ' | '.join(issues[:6]))
print('문제 있는 장면:', bad)
sys.exit(1 if bad else 0)
