"""tools/art-prompts.json 목록대로 Codex 이미지 생성(codex-imagegen 스킬)을 불러 원본을 그린다.

    python tools/gen-art.py                  # 아직 없는 것만 전부 (phase 1 → phase 2 순서)
    python tools/gen-art.py --only field,mat  # 골라서
    python tools/gen-art.py --only field --variant v2   # 다시 그리기 → art-src/gen/field-v2.png

- 원본은 art-src/gen/{id}.png (git 제외). 이미 있으면 덮어쓰지 않고 건너뛴다.
- phase 1(바닥·첫 화면)을 먼저 그리고, phase 2는 그 결과를 참고 그림(--ref "@id")으로 넘겨 톤을 잇는다.
- 동시에 3장까지. 한 장에 1~5분.
- 다 그린 뒤 python tools/postprocess.py --gen 으로 assets/ 에 넣는다.
"""
import argparse
import json
import os
import pathlib
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor

for s in (sys.stdout, sys.stderr):
    try:
        s.reconfigure(encoding="utf-8")
    except Exception:
        pass

ROOT = pathlib.Path(__file__).resolve().parent.parent
GEN = ROOT / "art-src" / "gen"
SKILL = pathlib.Path(os.path.expanduser("~/.claude/skills/codex-imagegen/scripts/gen_image.py"))


def raw_path(item_id, variant):
    return GEN / (item_id + ("-" + variant if variant else "") + ".png")


def resolve_ref(ref, variant):
    if ref.startswith("@"):
        # 앞 단계 그림: 고른 버전(use)이 있으면 그것, 없으면 기본 원본
        return raw_path(ref[1:], None)
    return ROOT / ref


def run(item, styles, variant, log):
    out = raw_path(item["id"], variant)
    if out.exists():
        print(f"· {item['id']}: 이미 있음 → 건너뜀 ({out.name})")
        return True
    refs = [resolve_ref(r, variant) for r in item.get("refs", [])]
    refs = [r for r in refs if r.exists()]
    prompt = item["prompt"] + " " + styles[item["tone"]]
    cmd = [sys.executable, str(SKILL), "--prompt", prompt, "--out", str(out), "--timeout", "600"]
    for r in refs:
        cmd += ["--ref", str(r)]
    print(f"▶ {item['id']} 그리는 중 (참고 {len(refs)}장)")
    t0 = time.time()
    p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace",
                       env=dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONUTF8="1"))
    ok = p.returncode == 0 and out.exists()
    sec = round(time.time() - t0)
    log[item["id"] + ("-" + variant if variant else "")] = {
        "ok": ok, "sec": sec, "refs": [str(r.relative_to(ROOT)) for r in refs],
        "tail": (p.stdout + p.stderr).strip().splitlines()[-3:],
    }
    print(("✅ " if ok else "❌ ") + f"{item['id']} ({sec}s)" + ("" if ok else "\n   " + "\n   ".join(log[item['id'] + ('-' + variant if variant else '')]["tail"])))
    return ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--variant", default="")
    ap.add_argument("--jobs", type=int, default=3)
    a = ap.parse_args()

    spec = json.loads((ROOT / "tools" / "art-prompts.json").read_text(encoding="utf-8"))
    only = set(x for x in a.only.split(",") if x)
    items = [it for it in spec["items"] if not only or it["id"] in only]
    GEN.mkdir(parents=True, exist_ok=True)
    log_file = GEN / "log.json"
    log = json.loads(log_file.read_text(encoding="utf-8")) if log_file.exists() else {}

    for phase in (1, 2):
        batch = [it for it in items if it.get("phase", 2) == phase]
        if not batch:
            continue
        with ThreadPoolExecutor(max_workers=a.jobs) as ex:
            list(ex.map(lambda it: run(it, spec["styles"], a.variant, log), batch))
        log_file.write_text(json.dumps(log, ensure_ascii=False, indent=2), encoding="utf-8")

    bad = [k for k, v in log.items() if not v["ok"]]
    print("끝." + (" 실패: " + ", ".join(bad) if bad else " 전부 성공"))


if __name__ == "__main__":
    main()
