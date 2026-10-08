// 게임에 쓰는 포켓몬 그림을 폴더 안으로 내려받는다 (인터넷 없이도 판이 돌아가게).
//
//   node tools/fetch-assets.js
//   python tools/postprocess.py --official     ← 공식 일러스트를 가벼운 webp로 줄이기
//
// - 도트 앞모습 96px: 1~1025 전부 → assets/sprites/front/{id}.png   (말·팀 고르기·배틀의 상대)
// - 도트 뒷모습 96px: 1~1025 전부 → assets/sprites/back/{id}.png    (잡기 배틀의 내 포켓몬)
// - 공식 일러스트: 고정 출연진만   → art-src/official/{id}.png (원본, git 제외)
// - 볼 아이콘                     → assets/items/
// - 로켓단 도트 그림 (잉글리시몬 img/ 에서 복사) → assets/ui/
// 이미 있는 파일은 건너뛴다. 끝나면 assets/manifest.json 에 개수·용량·없는 번호를 적는다.
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const ENGMON = path.resolve(ROOT, "..");
const BASE = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/";
const CONC = 8;
const BUDGET = 6 * 1024 * 1024;

// index.html 의 CAST 와 같게 유지할 것
const CAST = {
  yut: [498, 58, 179, 128, 77, 79],            // 도·개·걸·윷·모·빽도
  rocket: [24, 109, 52, 202],                  // 로켓단 말: 아보크·또가스·나옹·마자용
};
const BALLS = ["poke-ball", "great-ball", "ultra-ball", "luxury-ball", "master-ball"]; // v2 볼 5단계
const ROCKET_IMG = ["rocket-jessie", "rocket-james", "rocket-meowth", "rocket-wobbuffet"];

const jobs = [];
for (let id = 1; id <= 1025; id++) {
  jobs.push({ kind: "front", url: BASE + "pokemon/" + id + ".png", out: path.join(ROOT, "assets/sprites/front", id + ".png"), id });
  jobs.push({ kind: "back", url: BASE + "pokemon/back/" + id + ".png", out: path.join(ROOT, "assets/sprites/back", id + ".png"), id });
}
[...CAST.yut, ...CAST.rocket].forEach(id => {
  jobs.push({ kind: "official", url: BASE + "pokemon/other/official-artwork/" + id + ".png", out: path.join(ROOT, "art-src/official", id + ".png"), id });
});
BALLS.forEach(b => jobs.push({ kind: "items", url: BASE + "items/" + b + ".png", out: path.join(ROOT, "assets/items", b + ".png"), id: b }));

const missing = { front: [], back: [], official: [], items: [] };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(job) {
  if (fs.existsSync(job.out) && fs.statSync(job.out).size > 0) return "skip";
  fs.mkdirSync(path.dirname(job.out), { recursive: true });
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(job.url);
      if (r.status === 404) { missing[job.kind].push(job.id); return "404"; }
      if (!r.ok) throw new Error("HTTP " + r.status);
      fs.writeFileSync(job.out, Buffer.from(await r.arrayBuffer()));
      return "ok";
    } catch (e) {
      if (attempt >= 4) { missing[job.kind].push(job.id); console.warn("실패", job.url, e.message); return "fail"; }
      await sleep(700 * attempt);
    }
  }
}

function dirStat(dir) {
  let count = 0, bytes = 0;
  if (!fs.existsSync(dir)) return { count, bytes };
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) { const s = dirStat(p); count += s.count; bytes += s.bytes; }
    else if (f.name !== ".gitkeep") { count++; bytes += fs.statSync(p).size; }
  }
  return { count, bytes };
}

(async () => {
  const queue = jobs.slice();
  const tally = { ok: 0, skip: 0, "404": 0, fail: 0 };
  let n = 0;
  await Promise.all(Array.from({ length: CONC }, async () => {
    while (queue.length) {
      const r = await get(queue.shift());
      tally[r]++;
      if (++n % 200 === 0) console.log(n + "/" + jobs.length);
    }
  }));

  // 로켓단 도트 그림은 잉글리시몬 img/ 에서 복사 (폴더 안에서 끝나게)
  ROCKET_IMG.forEach(name => {
    const src = path.join(ENGMON, "img", name + ".png");
    const out = path.join(ROOT, "assets/ui", name + ".png");
    if (!fs.existsSync(out) && fs.existsSync(src)) fs.copyFileSync(src, out);
    if (!fs.existsSync(out)) console.warn("⚠️ 로켓단 그림 없음:", src);
  });

  const manifest = {
    updated: new Date().toISOString(),
    cast: CAST,
    front: Object.assign(dirStat(path.join(ROOT, "assets/sprites/front")), { missing: missing.front.sort((a, b) => a - b) }),
    back: Object.assign(dirStat(path.join(ROOT, "assets/sprites/back")), { missing: missing.back.sort((a, b) => a - b) }),
    official_src: Object.assign(dirStat(path.join(ROOT, "art-src/official")), { missing: missing.official }),
    items: Object.assign(dirStat(path.join(ROOT, "assets/items")), { missing: missing.items }),
    assets_total: dirStat(path.join(ROOT, "assets")),
  };
  fs.writeFileSync(path.join(ROOT, "assets/manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  const mb = b => (b / 1024 / 1024).toFixed(2) + "MB";
  console.log("받음", tally.ok, "· 이미 있음", tally.skip, "· 없음(404)", tally["404"], "· 실패", tally.fail);
  console.log("도트 앞모습", manifest.front.count + "개", mb(manifest.front.bytes), "없는 번호:", manifest.front.missing.join(",") || "없음");
  console.log("도트 뒷모습", manifest.back.count + "개", mb(manifest.back.bytes), "없는 번호:", manifest.back.missing.join(",") || "없음");
  console.log("공식 일러스트 원본", manifest.official_src.count + "개", mb(manifest.official_src.bytes));
  console.log("assets 전체", mb(manifest.assets_total.bytes), manifest.assets_total.bytes > BUDGET ? "⚠️ 6MB 예산 초과!" : "(예산 6MB 안)");
})();
