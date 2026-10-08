// PokeAPI에서 "진화 전 포켓몬 번호"(evolves_from_species)를 받아 data/evo-from.json 에 저장한다.
// 잉글리시몬의 EVO_LINES 는 번호순이라 진화 순서(피츄 → 피카츄 → 라이츄)를 모르기 때문.
//
//   node tools/fetch-evo.js
//
// 응답은 tools/.cache/species/{id}.json 에 필요한 값만 캐시 → 다시 돌려도 PokeAPI를 또 부르지 않는다.
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CACHE = path.join(__dirname, ".cache", "species");
const OUT = path.join(ROOT, "data", "evo-from.json");
const TOTAL = 1025;
const CONC = 8;

fs.mkdirSync(CACHE, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const idOf = url => Number(/\/(\d+)\/?$/.exec(url)[1]);

async function species(id) {
  const f = path.join(CACHE, id + ".json");
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf8"));
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch("https://pokeapi.co/api/v2/pokemon-species/" + id + "/");
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      const slim = {
        id,
        from: j.evolves_from_species ? idOf(j.evolves_from_species.url) : 0,
        chain: j.evolution_chain ? idOf(j.evolution_chain.url) : 0,
      };
      fs.writeFileSync(f, JSON.stringify(slim));
      return slim;
    } catch (e) {
      if (attempt >= 4) throw new Error("#" + id + " 실패: " + e.message);
      await sleep(800 * attempt);
    }
  }
}

(async () => {
  const ids = Array.from({ length: TOTAL }, (_, i) => i + 1);
  const out = {};
  let done = 0;
  async function worker() {
    while (ids.length) {
      const id = ids.shift();
      const s = await species(id);
      if (s.from) out[id] = s.from;
      if (++done % 100 === 0) console.log(done + "/" + TOTAL);
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));

  // 번호순으로 정렬해 저장 (diff 보기 쉽게)
  const sorted = {};
  Object.keys(out).map(Number).sort((a, b) => a - b).forEach(k => { sorted[k] = out[k]; });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(sorted) + "\n");
  console.log("진화 전 정보가 있는 포켓몬 " + Object.keys(sorted).length + "마리 → " + path.relative(ROOT, OUT));
})().catch(e => { console.error(e.message); process.exit(1); });
