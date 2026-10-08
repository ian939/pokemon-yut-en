"""그림 다듬기 (Pillow).

    python tools/postprocess.py --official      # art-src/official/*.png → assets/sprites/art/{id}.webp (400px)
    python tools/postprocess.py --bbox          # 도트 앞모습의 실제 그림 영역 → data/sprite-box.json
    python tools/postprocess.py --gen           # art-src/gen/*.png → assets/ (tools/art-prompts.json 설정대로)
    python tools/postprocess.py --gen field,mat # 골라서
    python tools/postprocess.py --sheet         # 만든 그림을 한 장에 모아 art-src/contact.png (검수용)

도트 톤: 흰 배경 제거 → 그림 영역만 자르기 → 목표 해상도로 줄이기 → 색 수 줄이기(디더링 없음)
         → 저해상도 그대로 저장 (화면에서 image-rendering: pixelated 로 키운다 = 말 그림과 같은 방식)
일러스트 톤: 목표 폭으로 부드럽게 줄여 webp.
"""
import argparse
import json
import pathlib
import sys

from PIL import Image, ImageDraw

for s in (sys.stdout, sys.stderr):
    try:
        s.reconfigure(encoding="utf-8")
    except Exception:
        pass

ROOT = pathlib.Path(__file__).resolve().parent.parent
GEN = ROOT / "art-src" / "gen"


# ---------- 공식 일러스트 ----------
def official():
    src = ROOT / "art-src" / "official"
    out = ROOT / "assets" / "sprites" / "art"
    out.mkdir(parents=True, exist_ok=True)
    total = 0
    for f in sorted(src.glob("*.png"), key=lambda p: int(p.stem)):
        im = Image.open(f).convert("RGBA")
        im.thumbnail((400, 400), Image.LANCZOS)
        dst = out / (f.stem + ".webp")
        im.save(dst, "WEBP", quality=86, method=6)
        total += dst.stat().st_size
    print(f"공식 일러스트 → assets/sprites/art/*.webp  {total / 1024:.0f}KB")


# ---------- 도트 앞모습·뒷모습의 그림 영역 ----------
def bbox():
    (ROOT / "data").mkdir(exist_ok=True)
    for kind, name in (("front", "sprite-box.json"), ("back", "sprite-box-back.json")):
        folder = ROOT / "assets" / "sprites" / kind
        if not folder.exists():
            continue
        boxes = []
        for i in range(1, 1026):
            f = folder / f"{i}.png"
            b = None
            if f.exists():
                a = Image.open(f).convert("RGBA").getchannel("A").point(lambda v: 255 if v > 24 else 0)
                b = a.getbbox()
            b = b or (16, 16, 80, 80)
            boxes.append([b[0], b[1], b[2] - b[0], b[3] - b[1]])
        (ROOT / "data" / name).write_text(json.dumps(boxes, separators=(",", ":")) + "\n", encoding="utf-8")
        print(f"{kind} 그림 영역 1025개 → data/{name} (node tools/extract-data.js 로 합치기)")


# ---------- Codex 그림 다듬기 ----------
def remove_bg(im, tol=38):
    """테두리에 닿은 배경만 지운다 (그림 안쪽의 흰 반짝임은 남김).
    배경색은 네 모서리의 가운데 값으로 정한다 — 흰 배경을 부탁해도 가끔 검은 배경으로 나온다."""
    im = im.convert("RGBA")
    w, h = im.size
    px = im.load()
    corners = [px[0, 0], px[w - 1, 0], px[0, h - 1], px[w - 1, h - 1]]
    bg = tuple(sorted(c[i] for c in corners)[1] for i in range(3))
    if max(bg) < 90:
        tol = 18  # 어두운 배경은 그림의 검은 테두리를 먹지 않게 좁게
    near = lambda c: all(abs(c[i] - bg[i]) <= tol * 1.5 for i in range(3))
    seeds = []
    step = max(4, min(w, h) // 64)
    for x in range(0, w, step):
        seeds += [(x, 0), (x, h - 1)]
    for y in range(0, h, step):
        seeds += [(0, y), (w - 1, y)]
    for sx, sy in seeds:
        c = px[sx, sy]
        if c[3] == 0 or not near(c):
            continue
        ImageDraw.floodfill(im, (sx, sy), (0, 0, 0, 0), thresh=tol)
    return im


def premul_resize(im, size):
    return im.convert("RGBa").resize(size, Image.LANCZOS).convert("RGBA")


def quantize(im, colors):
    """색 수 줄이기 (디더링 없음). 투명 부분은 따로 보관했다가 되돌린다."""
    alpha = im.getchannel("A")
    rgb = Image.new("RGB", im.size, (128, 128, 128))
    rgb.paste(im.convert("RGB"), mask=alpha.point(lambda v: 255 if v >= 128 else 0))
    q = rgb.quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert("RGBA")
    q.putalpha(alpha.point(lambda v: 255 if v >= 128 else 0))
    return q


def to_palette(img):
    """이미 색을 줄인 그림을 색 그대로 팔레트 PNG 로 (투명은 0번). 용량이 크게 준다."""
    img = img.convert("RGBA")
    alpha = img.getchannel("A")
    rgb = img.convert("RGB")
    uniq = rgb.getcolors(maxcolors=255)
    if uniq is None:
        return img, None
    has_t = alpha.getextrema()[0] < 128
    palette, lut = ([0, 0, 0] if has_t else []), {}
    for _, c in uniq:
        lut[c] = len(palette) // 3
        palette += list(c)
    p = Image.new("P", img.size)
    p.putpalette(palette + [0] * (768 - len(palette)))
    src, a, dst = rgb.load(), alpha.load(), p.load()
    for y in range(img.height):
        for x in range(img.width):
            dst[x, y] = 0 if (has_t and a[x, y] < 128) else lut[src[x, y]]
    return p, (0 if has_t else None)


def clean_fringe(im):
    """투명 칸에 닿은 거의 흰 테두리 점을 지운다 (흰 배경 잔여물)."""
    w, h = im.size
    px = im.load()
    kill = []
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0 or min(r, g, b) < 232:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if nx < 0 or ny < 0 or nx >= w or ny >= h or px[nx, ny][3] == 0:
                    kill.append((x, y))
                    break
    for x, y in kill:
        px[x, y] = (0, 0, 0, 0)
    return im


def trim(im):
    b = im.getchannel("A").point(lambda v: 255 if v > 40 else 0).getbbox()
    return im.crop(b) if b else im


def fit_square(im, side):
    """비율을 지키며 side×side 안에 맞추고 가운데 정렬."""
    w, h = im.size
    k = side / max(w, h)
    small = premul_resize(im, (max(1, round(w * k)), max(1, round(h * k))))
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.alpha_composite(small, ((side - small.width) // 2, (side - small.height) // 2))
    return canvas


def center_square(im):
    w, h = im.size
    s = min(w, h)
    return im.crop(((w - s) // 2, (h - s) // 2, (w - s) // 2 + s, (h - s) // 2 + s))


def split_columns(im, n):
    """투명한 세로 틈을 찾아 n 조각으로 나눈다 (윷가락 3개 시트)."""
    a = im.getchannel("A")
    w, h = im.size
    cols = [any(a.getpixel((x, y)) > 40 for y in range(0, h, 2)) for x in range(w)]
    runs, start = [], None
    for x, filled in enumerate(cols + [False]):
        if filled and start is None:
            start = x
        elif not filled and start is not None:
            if x - start > w * 0.03:
                runs.append((start, x))
            start = None
    if len(runs) != n:
        # 틈을 못 찾으면 똑같이 나눈다
        runs = [(round(w * i / n), round(w * (i + 1) / n)) for i in range(n)]
    return [trim(im.crop((x0, 0, x1, h))) for x0, x1 in runs]


def raw_for(item):
    name = item.get("use") or item["id"]
    p = GEN / f"{name}.png"
    return p if p.exists() else None


def process(item):
    src = raw_for(item)
    if not src:
        print(f"· {item['id']}: 원본 없음 → 건너뜀")
        return
    im = Image.open(src).convert("RGBA")
    outs = []
    if item["tone"] == "pixel":
        lowres, colors = item.get("lowres", 64), item.get("colors", 24)
        if item.get("transparent"):
            im = remove_bg(im)
        if item.get("split"):
            parts = split_columns(im, len(item["split"]))
            # 세 가락을 같은 크기로: 가장 긴 조각 기준 비율
            hmax = max(p.height for p in parts)
            for part, dst in zip(parts, item["split"]):
                k = lowres / hmax
                small = premul_resize(part, (max(1, round(part.width * k)), max(1, round(part.height * k))))
                small = clean_fringe(quantize(small, colors))
                outs.append((small, dst))
        elif item.get("transparent"):
            part = trim(im)
            if item.get("keepAspect"):
                # 가로로 긴 발판처럼 정사각형 여백 없이 긴 변만 맞춘다
                k = lowres / max(part.size)
                small = premul_resize(part, (max(1, round(part.width * k)), max(1, round(part.height * k))))
            else:
                small = fit_square(part, lowres)
            outs.append((clean_fringe(quantize(small, colors)), item["out"]))
        elif item.get("wh"):
            # 16:9 배경 — 가운데를 그 비율로 잘라 목표 크기로
            tw, th = item["wh"]
            w, h = im.size
            if w / h > tw / th:
                cw = round(h * tw / th)
                im = im.crop(((w - cw) // 2, 0, (w - cw) // 2 + cw, h))
            else:
                ch = round(w * th / tw)
                im = im.crop((0, (h - ch) // 2, w, (h - ch) // 2 + ch))
            outs.append((quantize(premul_resize(im, (tw, th)), colors), item["out"]))
        else:
            sq = center_square(im)
            small = premul_resize(sq, (lowres, lowres))
            if item["id"] == "path":
                # 거울상 2×2 로 이어 붙이면 이음새가 생기지 않는다
                q = quantize(small, colors)
                tile = Image.new("RGBA", (lowres * 2, lowres * 2))
                tile.paste(q, (0, 0))
                tile.paste(q.transpose(Image.FLIP_LEFT_RIGHT), (lowres, 0))
                tile.paste(q.transpose(Image.FLIP_TOP_BOTTOM), (0, lowres))
                tile.paste(q.transpose(Image.ROTATE_180), (lowres, lowres))
                outs.append((tile, item["out"]))
            else:
                outs.append((quantize(small, colors), item["out"]))
    else:
        size = item.get("size", 1280)
        if item.get("icon"):
            sq = center_square(im)
            for s in item["icon"]:
                dst = str(pathlib.Path(item["out"]).with_name(f"icon-{s}.png"))
                icon = premul_resize(sq, (s, s)).convert("RGB")
                # 아이콘은 256색 팔레트로 (512px 394KB → 130KB 안팎)
                outs.append((icon.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG), dst))
        else:
            w, h = im.size
            k = size / max(w, h)
            outs.append((premul_resize(im, (round(w * k), round(h * k))), item["out"]))
    for img, dst in outs:
        p = ROOT / dst
        p.parent.mkdir(parents=True, exist_ok=True)
        if p.suffix == ".webp":
            img.save(p, "WEBP", quality=82, method=6)
        elif item["tone"] == "pixel":
            pal, t = to_palette(img)
            if t is None:
                pal.save(p, optimize=True)
            else:
                pal.save(p, optimize=True, transparency=t)
        else:
            img.save(p, optimize=True)
        print(f"✅ {item['id']} → {dst}  {img.width}×{img.height}  {p.stat().st_size / 1024:.1f}KB")


def gen(only):
    spec = json.loads((ROOT / "tools" / "art-prompts.json").read_text(encoding="utf-8"))
    for item in spec["items"]:
        if only and item["id"] not in only:
            continue
        process(item)


# ---------- 검수용 모아 보기 ----------
def sheet():
    spec = json.loads((ROOT / "tools" / "art-prompts.json").read_text(encoding="utf-8"))
    files = []
    for item in spec["items"]:
        for dst in item.get("split") or ([str(pathlib.Path(item["out"]).with_name("icon-512.png"))] if item.get("icon") else [item["out"]]):
            p = ROOT / dst
            if p.exists():
                files.append(p)
    cell = 240
    cols = 4
    rows = (len(files) + cols - 1) // cols or 1
    out = Image.new("RGBA", (cols * cell, rows * cell), (120, 190, 110, 255))
    for i, f in enumerate(files):
        im = Image.open(f).convert("RGBA")
        k = (cell - 16) / max(im.size)
        im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.NEAREST)
        out.alpha_composite(im, ((i % cols) * cell + (cell - im.width) // 2, (i // cols) * cell + (cell - im.height) // 2))
    dst = ROOT / "art-src" / "contact.png"
    out.save(dst)
    print("검수용 모아 보기 →", dst)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--official", action="store_true")
    ap.add_argument("--bbox", action="store_true")
    ap.add_argument("--gen", nargs="?", const="", default=None)
    ap.add_argument("--sheet", action="store_true")
    a = ap.parse_args()
    if a.official:
        official()
    if a.bbox:
        bbox()
    if a.gen is not None:
        gen(set(x for x in a.gen.split(",") if x))
    if a.sheet:
        sheet()
