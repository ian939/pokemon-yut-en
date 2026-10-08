// 로켓단 컴퓨터 난이도 확인.   node tools/sim-cpu.js [판 수]
// 기준(M4): 보통이 쉬움을 70% 이상 이김. "random" = 아무 수나 두는 상대 (아이와 비슷하다고 가정)
// v3: ✨ 기술을 켠 판도 잰다 — 말마다 마지막 모습 타입의 기술, random 은 쓸 수 있으면 반쯤 아무 기술이나
const Y = require("../yut-rules.js");
const D = require("../data/pokemon.js");

const N = Number(process.argv[2]) || 1000;
let rs = 2026;
const rnd = () => { const r = Y.rand(rs); rs = r[1]; return r[0]; };
const choose = (s, level) => level === "random"
  ? (ms => ms[Math.floor(rnd() * ms.length)])(Y.legalMoves(s))
  : Y.cpuChoose(s, level, rnd);
const typesOf = id => String(D.types[id - 1] || "노말").split("·");
const poolOf = id => [...new Set([].concat(...typesOf(id).map(t => Y.TYPE_SKILLS[t] || [])))];
function skillFor(s, level) {
  if (level === "random") {
    const list = Y.legalSkills(s);
    if (!list.length || rnd() < 0.5) return null;
    const x = list[Math.floor(rnd() * list.length)];
    return { piece: x.piece, target: x.targets[Math.floor(rnd() * x.targets.length)] };
  }
  return Y.cpuSkill(s, level, rnd);
}

function play(levels, seed, first, pieces, skills) {
  // 사람 팀(0): 스타팅 포켓몬 → 마지막 모습까지 · 로켓단(1): 아보크·또도가스·페르시온·마자용
  const t0 = [[1, 2, 3], [4, 5, 6], [7, 8, 9], [152, 153, 154]];
  const t1 = [[23, 24], [109, 110], [52, 53], [360, 202]];
  const team = (name, paths) => ({ name, picks: paths.map(p => p[0]), paths, pools: paths.map(p => poolOf(p[p.length - 1])) });
  let s = Y.newGame({ pieces, backdo: true, seed, first, skills, teams: [team("A", t0), team("B", t1)] }, D.evoFrom);
  while (s.phase !== "over") {
    const a = skills ? skillFor(s, levels[s.turn]) : null;
    if (a) s = Y.applySkill(s, a.piece, a.target).state;
    else if (s.phase === "throw") s = Y.applyThrow(s).state;
    else s = Y.applyMove(s, choose(s, levels[s.turn]).id).state;
  }
  return s.winner;
}

let failed = false;
[false, true].forEach(skills => {
  console.log(skills ? "── ✨ 기술 켬 ──" : "── 기술 없음 ──");
  [4, 2].forEach(pieces => {
    // 마지막 두 줄이 실제 판: 아이(아무렇게나, 스타팅 포켓몬) vs 로켓단 쉬움·보통 — 아이의 승률
    [["normal", "easy"], ["normal", "random"], ["easy", "random"], ["hard", "random"], ["random", "easy"], ["random", "normal"], ["random", "hard"]].forEach(([a, b]) => {
      let win = 0;
      for (let g = 0; g < N; g++) if (play([a, b], g + 1, g % 2, pieces, skills) === 0) win++;
      const pct = win / N * 100;
      const gate = pieces === 4 && a === "normal" && b === "easy" && !skills;
      if (gate && pct < 70) failed = true;
      const who = a === "random" ? "아이 vs 로켓단 " + ({ easy: "🌱 쉬움", normal: "🔥 보통", hard: "💀 어려움" })[b] : a + " vs " + b;
      console.log("말 " + pieces + "개 · " + who + ": " + pct.toFixed(1) + "% 승" + (gate ? (pct >= 70 ? "  ✅ 기준 70%" : "  ❌ 기준 70%") : ""));
    });
  });
});
process.exit(failed ? 1 : 0);
