// 잉글리시몬 index.html 에 들어 있는 포켓몬 데이터를 잘라 data/pokemon.js 로 만든다.
// data/evo-from.json (fetch-evo.js 결과)도 함께 합친다.
//
//   node tools/extract-data.js [잉글리시몬 index.html 경로]
//
// 기본 경로는 이 폴더 바로 위의 index.html (98. english/index.html).
// 잉글리시몬 쪽 데이터가 바뀌면 다시 돌린다. data/pokemon.js 는 손으로 고치지 않는다.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.resolve(process.argv[2] || process.env.ENGMON_HTML || path.join(ROOT, "..", "index.html"));
const EVO = path.join(ROOT, "data", "evo-from.json");
const BOX = path.join(ROOT, "data", "sprite-box.json"); // postprocess.py --bbox 결과 (도트 그림의 실제 영역)
const BOX_BACK = path.join(ROOT, "data", "sprite-box-back.json"); // 뒷모습 그림의 실제 영역 (잡기 배틀)
const OUT = path.join(ROOT, "data", "pokemon.js");

const html = fs.readFileSync(SRC, "utf8");

// `const NAME = <식>;` 의 <식> 부분을 괄호 짝을 맞춰 잘라낸다 (문자열·주석 안의 괄호는 무시)
function grab(name) {
  const m = new RegExp("const " + name + "\\s*=\\s*").exec(html);
  if (!m) throw new Error(name + " 를 찾지 못함");
  let i = m.index + m[0].length;
  const start = i;
  let depth = 0, opened = false;
  while (i < html.length) {
    const c = html[i], n = html[i + 1];
    if (c === "/" && n === "/") { i = html.indexOf("\n", i); continue; }
    if (c === "/" && n === "*") { i = html.indexOf("*/", i) + 2; continue; }
    if (c === '"' || c === "'" || c === "`") {
      i++;
      while (html[i] !== c) i += html[i] === "\\" ? 2 : 1;
      i++;
      continue;
    }
    if ("([{".includes(c)) { depth++; opened = true; }
    else if (")]}".includes(c)) {
      depth--;
      if (opened && depth === 0) return html.slice(start, i + 1);
    }
    i++;
  }
  throw new Error(name + " 의 끝을 찾지 못함");
}
const val = name => vm.runInNewContext("(" + grab(name) + ")", { Set });

const NAMES = val("POKEMON_KO");
const RARITY_SETS = val("RARITY_SETS");
const GENERATIONS = val("GENERATIONS");
const DEX_INFO = val("DEX_INFO");
const TYPE_ONLY = val("TYPE_ONLY");
const TYPE_COLORS = val("TYPE_COLORS");
const TYPE_DARK = val("TYPE_DARK");
const TYPE_FX = val("TYPE_FX");
const TYPE_MOVE = val("TYPE_MOVE");
const APP_VERSION = (/const APP_VERSION = "([^"]+)"/.exec(html) || [])[1] || "?";

const TOTAL = NAMES.length;
if (TOTAL !== 1025) throw new Error("이름이 1025개가 아님: " + TOTAL);

// 타입: 1~386 은 DEX_INFO[id][0], 387~ 는 TYPE_ONLY
const types = [];
const moves = {}; // 1~386: 도감의 "좋아하는 기술" 첫 번째 (나머지는 타입 대표 기술을 쓴다)
for (let id = 1; id <= TOTAL; id++) {
  const t = DEX_INFO[id] ? DEX_INFO[id][0] : TYPE_ONLY[id];
  if (!t) throw new Error("#" + id + " 타입 없음");
  types.push(t);
  if (DEX_INFO[id] && DEX_INFO[id][1]) moves[id] = DEX_INFO[id][1].split("·")[0].trim();
}

// 희귀도: 일반(c)은 생략
const rarity = {};
[["legendary", "l"], ["unique", "u"], ["rare", "r"]].forEach(([k, code]) => {
  RARITY_SETS[k].forEach(id => { if (!rarity[id]) rarity[id] = code; });
});

let evoFrom = {};
if (fs.existsSync(EVO)) evoFrom = JSON.parse(fs.readFileSync(EVO, "utf8"));
else console.warn("⚠️ data/evo-from.json 이 없어요 — 먼저 node tools/fetch-evo.js 를 돌리세요 (진화 없이 만듭니다)");

let box = null, boxBack = null;
if (fs.existsSync(BOX_BACK)) boxBack = JSON.parse(fs.readFileSync(BOX_BACK, "utf8"));
if (fs.existsSync(BOX)) box = JSON.parse(fs.readFileSync(BOX, "utf8"));
else console.warn("⚠️ data/sprite-box.json 이 없어요 — python tools/postprocess.py --bbox (말 크기 맞추기 없이 만듭니다)");

const D = {
  built: new Date().toISOString().slice(0, 10),
  source: "english-mon index.html v" + APP_VERSION,
  names: NAMES,
  types,
  moves,
  rarity,
  gens: GENERATIONS,
  evoFrom,
  typeColors: TYPE_COLORS,
  typeDark: [...TYPE_DARK],
  typeFx: TYPE_FX,
  typeMove: TYPE_MOVE,
  box, // [x, y, w, h] (96px 도트 그림 안의 실제 그림 영역), index = 번호-1
  boxBack, // 뒷모습 그림의 실제 영역 — 잡기 배틀에서 발판에 발을 맞출 때
};

const body =
  "/* 자동 생성 파일 — 손으로 고치지 말 것. node tools/extract-data.js 로 다시 만든다.\n" +
  "   출처: 잉글리시몬 index.html (이름·타입·희귀도·지역·기술) + PokeAPI evolves_from_species (진화 순서) */\n" +
  "(function () {\n  var D = " + JSON.stringify(D) + ";\n" +
  '  if (typeof window !== "undefined") window.YUT_DATA = D;\n' +
  '  if (typeof module !== "undefined") module.exports = D;\n' +
  "})();\n";
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, body);
console.log(
  "data/pokemon.js: " + TOTAL + "마리 · 기술 " + Object.keys(moves).length +
  " · 희귀 " + Object.keys(rarity).length + " · 진화 " + Object.keys(evoFrom).length +
  " · " + (body.length / 1024).toFixed(1) + "KB (" + D.source + ")"
);
