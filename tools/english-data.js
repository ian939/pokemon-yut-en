/* 영어판: data/pokemon.js 의 화면에 보이는 글자(포켓몬 이름·기술 이름·지역)를 영어로 바꾼다.
 *
 *   node tools/extract-data.js   (한국어 원본을 다시 만들 때만)
 *   node tools/english-data.js
 *
 * - 출처: PokeAPI CSV (pokemon_species_names · move_names) — 한국어(3) ↔ 영어(9) 를 짝지어 바꾼다.
 *   받은 CSV 는 tools/.cache/csv/ 에 둔다 (git 제외).
 * - 타입(풀·불꽃…)·희귀도 같은 안쪽 값은 한국어 그대로 둔다 — 규칙·상성표가 그 글자를 열쇠로 쓴다.
 *   화면에 보일 때만 index.html 의 typeName() 이 영어로 바꾼다.
 * - 이미 영어로 바뀐 파일에 다시 돌려도 된다 (한글이 없는 값은 그대로 둠).
 */
const fs = require("fs");
const path = require("path");
const https = require("https");

const ROOT = path.resolve(__dirname, "..");
const CACHE = path.join(__dirname, ".cache", "csv");
const BASE = "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/";
const KO = "3", EN = "9";

function get(url) {
  return new Promise((ok, bad) => https.get(url, r => {
    if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) return get(r.headers.location).then(ok, bad);
    if (r.statusCode !== 200) return bad(new Error(url + " " + r.statusCode));
    const b = []; r.on("data", c => b.push(c)); r.on("end", () => ok(Buffer.concat(b).toString("utf8")));
  }).on("error", bad));
}
async function csv(name) {
  const f = path.join(CACHE, name + ".csv");
  if (!fs.existsSync(f)) { fs.mkdirSync(CACHE, { recursive: true }); fs.writeFileSync(f, await get(BASE + name + ".csv")); }
  // id,언어,이름(,분류) — "…, …" 처럼 따옴표로 묶인 칸이 있다 (기술 이름 "10,000,000 Volt Thunderbolt")
  return fs.readFileSync(f, "utf8").split(/\r?\n/).slice(1).filter(Boolean).map(l => {
    const a = []; let cur = "", q = false;
    for (const ch of l) {
      if (ch === '"') q = !q;
      else if (ch === "," && !q) { a.push(cur); cur = ""; }
      else cur += ch;
    }
    a.push(cur);
    return a.slice(0, 3);
  });
}
const hasKo = s => /[가-힣]/.test(s);
const norm = s => s.replace(/\s+/g, "");

// PokeAPI 한국어 이름과 잉글리시몬 표기가 다른 기술 (빈칸·옛 이름)
const MOVE_FIX = {
  "섀도클로": "Shadow Claw", "10만볼트": "Thunderbolt", "솔라빔": "Solar Beam", "사이코키네시스": "Psychic",
  "돌풍": "Gust", "드릴부리": "Drill Peck", "독엄니": "Poison Fang", "백만볼트": "Zap Cannon", "바위부수기": "Rock Smash",
  "밤그림자": "Night Shade", "게거품": "Bubble", "달걀폭탄": "Egg Bomb", "바이스그립": "Vise Grip", "잠가루": "Sleep Powder",
  "숨겨진힘": "Hidden Power", "미사일바늘": "Pin Missile", "메탈크로우": "Metal Claw", "얼다바람": "Icy Wind",
  "더블킥": "Double Kick", "팔치기": "Arm Thrust", "물장구": "Splash", "매혹": "Attract", "신호빔": "Signal Beam",
  "사이코빔": "Psybeam", "니들암": "Needle Arm", "날씨부르기": "Weather Ball", "소원의힘": "Wish",
};
const REGION = { "관동": "Kanto", "성도": "Johto", "호연": "Hoenn", "신오": "Sinnoh", "하나": "Unova", "칼로스": "Kalos", "알로라": "Alola", "가라르": "Galar", "팔데아": "Paldea", "히스이": "Hisui" };

(async () => {
  const species = await csv("pokemon_species_names");
  const moves = await csv("move_names");
  const nameEn = {};
  for (const [id, lang, name] of species) if (lang === EN) nameEn[id] = name;
  const koMove = {}, enMove = {};
  for (const [id, lang, name] of moves) { if (lang === KO) koMove[norm(name)] = id; if (lang === EN) enMove[id] = name; }
  const moveEn = ko => MOVE_FIX[ko] || enMove[koMove[norm(ko)]];

  const file = path.join(ROOT, "data", "pokemon.js");
  const src = fs.readFileSync(file, "utf8");
  const m = /var D = (\{.*\});\r?\n/s.exec(src);
  const D = JSON.parse(m[1]);
  const miss = [];
  D.names = D.names.map((n, i) => !hasKo(n) ? n : nameEn[String(i + 1)] || (miss.push("name " + (i + 1) + " " + n), n));
  const mv = ko => !hasKo(ko) ? ko : moveEn(ko) || (miss.push("move " + ko), ko);
  for (const k in D.moves) D.moves[k] = mv(D.moves[k]);
  for (const k in D.typeMove) D.typeMove[k] = mv(D.typeMove[k]);
  for (const g of D.gens) if (hasKo(g.region)) g.region = REGION[g.region] || (miss.push("region " + g.region), g.region);
  D.lang = "en";
  fs.writeFileSync(file, src.replace(m[1], JSON.stringify(D)));
  console.log("names", D.names.length, "· moves", Object.keys(D.moves).length, "· 못 바꾼 것", miss.length);
  if (miss.length) { console.log(miss.join("\n")); process.exitCode = 1; }
})();
