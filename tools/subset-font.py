"""갈무리(Galmuri) 도트 글꼴을 게임에 쓰는 글자만 남겨 줄인다.

    python tools/subset-font.py

- 갈무리: 닌텐도 DS 글꼴 디자인을 바탕으로 한 한국어 비트맵 글꼴 (이민서, SIL OFL 1.1)
  https://github.com/quiple/galmuri — 원본은 art-src/fonts/ 에 받아 둔다 (git 제외)
- 남기는 글자: 자주 쓰는 한글 2,350자(KS X 1001) + index.html·data/pokemon.js·yut-rules.js 에 나오는 모든 글자
  + 영문·숫자·기호. 포켓몬 이름·기술이 바뀌면(extract-data.js 다시 돌린 뒤) 이것도 다시 돌린다.
- 결과: assets/fonts/galmuri11.woff2 · galmuri11-bold.woff2 · OFL.md (라이선스는 글꼴과 함께 배포해야 한다)
"""
import pathlib
import sys
import urllib.request

from fontTools import subset
from fontTools.ttLib import TTFont

for s in (sys.stdout, sys.stderr):
    try:
        s.reconfigure(encoding="utf-8")
    except Exception:
        pass

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "art-src" / "fonts"
OUT = ROOT / "assets" / "fonts"
BASE = "https://cdn.jsdelivr.net/npm/galmuri@2.40.3/dist/"
FONTS = {"galmuri11.woff2": "Galmuri11.woff2", "galmuri11-bold.woff2": "Galmuri11-Bold.woff2"}
LICENSE = "https://raw.githubusercontent.com/quiple/galmuri/main/ofl.md"


def fetch(url, dst):
    if dst.exists() and dst.stat().st_size > 0:
        return
    dst.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(url, timeout=60) as r:
        dst.write_bytes(r.read())


def charset():
    chars = set()
    # 자주 쓰는 한글 2,350자: EUC-KR 의 한글 영역 (0xB0A1 ~ 0xC8FE)
    for hi in range(0xB0, 0xC9):
        for lo in range(0xA1, 0xFF):
            try:
                chars.add(bytes([hi, lo]).decode("euc-kr"))
            except UnicodeDecodeError:
                pass
    # 게임 안에 실제로 나오는 글자 전부
    for f in ("index.html", "data/pokemon.js", "yut-rules.js"):
        chars.update((ROOT / f).read_text(encoding="utf-8"))
    chars.update(chr(c) for c in range(0x20, 0x7F))
    chars.update("·…~!?%×▶◀▲▼↩️★☆♪♥—–“”‘’「」『』")
    return {c for c in chars if c.isprintable() and not c.isspace() or c == " "}


def main():
    for out_name, src_name in FONTS.items():
        fetch(BASE + src_name, SRC / src_name)
    fetch(LICENSE, SRC / "ofl.md")
    OUT.mkdir(parents=True, exist_ok=True)
    chars = charset()
    text = "".join(sorted(chars))
    for out_name, src_name in FONTS.items():
        src = SRC / src_name
        font = TTFont(str(src))
        cmap = font.getBestCmap()
        have = sum(1 for c in chars if ord(c) in cmap)
        opts = subset.Options()
        opts.flavor = "woff2"
        opts.layout_features = ["*"]
        opts.name_IDs = ["*"]
        opts.notdef_outline = True
        sub = subset.Subsetter(opts)
        sub.populate(text=text)
        sub.subset(font)
        dst = OUT / out_name
        font.flavor = "woff2"
        font.save(str(dst))
        missing = sorted(c for c in chars if ord(c) not in cmap and ord(c) > 0x7F and "가" <= c <= "힣")
        print(f"{out_name}: {src.stat().st_size // 1024}KB → {dst.stat().st_size // 1024}KB  (글자 {have}/{len(chars)}, 없는 한글 {len(missing)}자{': ' + ''.join(missing[:20]) if missing else ''})")
    (OUT / "OFL.md").write_bytes((SRC / "ofl.md").read_bytes())
    print("라이선스 → assets/fonts/OFL.md")


if __name__ == "__main__":
    main()
