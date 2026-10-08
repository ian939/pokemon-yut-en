"""영어판 목소리: 게임이 읽어 주는 영어 문장을 Microsoft Edge TTS 로 미리 녹음해 둔다.

    pip install edge-tts
    python tools/gen-voice.py            # 새로 생긴 문장만 녹음 (이미 있는 것은 그대로)
    python tools/gen-voice.py --list     # 녹음할 문장만 보여 주기
    python tools/gen-voice.py --all      # 전부 다시 녹음

- 녹음할 문장 찾기 (index.html 을 읽는다):
  · TTS.say( … ) / TTS.sayEn( … ) 안의 글자, vo("…") 로 감싼 글자
  · 포켓몬 이름 1025개 (data/pokemon.js) · 포켓몬 기술 이름(배틀) · 판 기술 이름 · 볼 이름 · 윷 결과 이름 (yut-rules.js) · 희귀도 이름 · 숫자 0~100
  → 문장을 바꾸거나 새로 쓰면 이 스크립트를 다시 돌린다 (안 돌리면 그 말만 브라우저 목소리로 나온다).
- 결과: assets/voice/<열쇠의 md5 10자>.mp3 + assets/voice/voice.js (window.VOICE = { 열쇠: [파일, 말 시작초, 길이초] })
  열쇠 = 글자를 소문자로, 기호·이모지를 빼고 — index.html TTS.key() 와 똑같이 유지할 것
- 목소리: 보통은 en-US-AnaNeural (아이 목소리), "meow" 가 든 로켓단 말은 en-US-GuyNeural
- 쓰지 않게 된 mp3 는 지운다.
"""
import asyncio
import hashlib
import json
import pathlib
import re
import subprocess
import sys
import unicodedata

for s in (sys.stdout, sys.stderr):
    try:
        s.reconfigure(encoding="utf-8")
    except Exception:
        pass

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "voice"
VOICE = "en-US-AnaNeural"
ROCKET_VOICE = "en-US-GuyNeural"
RATE = "-5%"
EMOJI = re.compile("[\U0001F000-\U0001FAFF☀-➿️‍]")


def key(s):
    """index.html 의 TTS.key() 와 같게"""
    s = EMOJI.sub("", s).strip().replace("♀", " female").replace("♂", " male")
    s = "".join(c for c in unicodedata.normalize("NFD", s) if not unicodedata.combining(c))
    s = s.lower()
    s = re.sub("[’‘`]", "'", s)
    s = re.sub("[^a-z0-9'가-힣]+", " ", s)
    return s.strip()


def speak_text(s):
    """녹음에 넘길 글 — 이모지만 빼고 문장 부호는 둔다 (억양)"""
    s = EMOJI.sub("", s).strip()
    return re.sub(r"\s+", " ", s)


def calls(src):
    """TTS.say( / TTS.sayEn( / vo( 의 괄호 안 글을 돌려준다"""
    for m in re.finditer(r"(?<![\w$.])(?:TTS\.sayEn|TTS\.say|vo)\(", src):
        i, depth, q = m.end(), 1, None
        while i < len(src) and depth:
            c = src[i]
            if q:
                if c == "\\":
                    i += 1
                elif c == q:
                    q = None
            elif c in "\"'`":
                q = c
            elif c == "(":
                depth += 1
            elif c == ")":
                depth -= 1
            i += 1
        yield src[m.end():i - 1]


def literals(code):
    out = []
    for m in re.finditer(r'"((?:[^"\\\n]|\\.)*)"|\'((?:[^\'\\\n]|\\.)*)\'|`((?:[^`\\$]|\\.)*)`', code):
        s = next(g for g in m.groups() if g is not None)
        s = s.encode("utf-8").decode("unicode_escape").encode("latin-1").decode("utf-8") if "\\" in s else s
        out.append(s)
    return out


def node_data():
    js = r"""
const Y = require('./yut-rules.js'); const D = require('./data/pokemon.js');
console.log(JSON.stringify({
  names: D.names,
  moves: Object.values(D.moves).concat(Object.values(D.typeMove)),
  skills: Object.values(Y.SKILLS).map(k => k.name),
  balls: Object.values(Y.Rewards.BALL_INFO || {}).map(b => b.name),
  results: Object.values(Y.RESULTS).map(r => r.name),
}));"""
    r = subprocess.run(["node", "-e", js], cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
    if r.returncode:
        sys.exit(r.stderr)
    return json.loads(r.stdout)


def phrases():
    src = (ROOT / "index.html").read_text(encoding="utf-8")
    found, skipped = {}, []

    def add(s, why):
        t = speak_text(s)
        k = key(t)
        if not k or not re.search("[a-z]", k) and not k.isdigit():
            return
        if re.search("[가-힣]", k):
            skipped.append(t)
            return
        found.setdefault(k, (t, why))

    for body in calls(src):
        for s in literals(body):
            add(s, "code")
    d = node_data()
    for group in ("results", "skills", "balls", "moves", "names"):
        for s in d[group]:
            add(s, group)
    m = re.search(r"const RARITY_KO = \{([^}]*)\}", src)
    for s in literals(m.group(1)) if m else []:
        add(s, "rarity")
    for n in range(0, 101):
        add(str(n), "number")
    return found, skipped


async def record(text, voice, dst):
    import edge_tts
    for attempt in range(4):
        try:
            c = edge_tts.Communicate(text, voice, rate=RATE, boundary="WordBoundary")
            audio, words = bytearray(), []
            async for ch in c.stream():
                if ch["type"] == "audio":
                    audio += ch["data"]
                elif ch["type"] == "WordBoundary":
                    words.append((ch["offset"] / 1e7, (ch["offset"] + ch["duration"]) / 1e7))
            if not audio:
                raise RuntimeError("소리 없음")
            dst.write_bytes(bytes(audio))
            start = words[0][0] if words else 0
            end = words[-1][1] if words else 0
            return [round(start, 3), round(end - start, 3) if words else 0]
        except Exception as e:
            if attempt == 3:
                raise
            await asyncio.sleep(1.5 * (attempt + 1))


async def main():
    found, skipped = phrases()
    if "--list" in sys.argv:
        for k, (t, why) in sorted(found.items(), key=lambda x: x[1][1]):
            if why != "names":
                print(f"[{why}] {t}")
        print(len(found), "문장 (포켓몬 이름 포함)")
        if skipped:
            print("한글이라 뺀 것:", skipped)
        return
    OUT.mkdir(parents=True, exist_ok=True)
    meta_f = OUT / "meta.json"   # { 열쇠: {text, voice, clip} } — 다시 돌릴 때 바뀐 것만 녹음
    meta = json.loads(meta_f.read_text(encoding="utf-8")) if meta_f.exists() and "--all" not in sys.argv else {}
    todo = []
    for k, (t, why) in found.items():
        voice = ROCKET_VOICE if "meow" in k else VOICE
        f = hashlib.md5(k.encode("utf-8")).hexdigest()[:10] + ".mp3"
        old = meta.get(k)
        if old and old.get("text") == t and old.get("voice") == voice and (OUT / f).exists():
            continue
        todo.append((k, t, voice, f))
    print("녹음할 것", len(todo), "/ 전체", len(found))
    sem = asyncio.Semaphore(8)
    done = 0

    async def one(k, t, voice, f):
        nonlocal done
        async with sem:
            clip = await record(t, voice, OUT / f)
        meta[k] = {"text": t, "voice": voice, "file": f, "clip": clip}
        done += 1
        if done % 100 == 0:
            print(" ", done)

    results = await asyncio.gather(*(one(*x) for x in todo), return_exceptions=True)
    fails = [(x[1], r) for x, r in zip(todo, results) if isinstance(r, Exception)]
    meta = {k: v for k, v in meta.items() if k in found}
    meta_f.write_text(json.dumps(meta, ensure_ascii=False, indent=0, sort_keys=True), encoding="utf-8")
    table = {k: [v["file"]] + v["clip"] for k, v in sorted(meta.items())}
    (OUT / "voice.js").write_text(
        "/* 자동 생성 — python tools/gen-voice.py (Edge TTS 녹음 목록). 손으로 고치지 말 것 */\n"
        "window.VOICE = " + json.dumps(table, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    keep = {v["file"] for v in meta.values()}
    gone = [p for p in OUT.glob("*.mp3") if p.name not in keep]
    for p in gone:
        p.unlink()
    size = sum(p.stat().st_size for p in OUT.glob("*.mp3"))
    print(f"완료: {len(meta)}개 · {size / 1e6:.1f}MB · 지운 것 {len(gone)} · 실패 {len(fails)}")
    for t, e in fails[:20]:
        print("  실패:", t, e)
    if skipped:
        print("한글이라 뺀 것:", skipped)
    if fails:
        sys.exit(1)


asyncio.run(main())
