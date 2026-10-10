// 규칙 엔진 테스트 — 의존성 없음.   node tools/test-rules.js
const Y = require("../yut-rules.js");
const D = require("../data/pokemon.js");

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("✅ " + name); }
  catch (e) { fail++; console.log("❌ " + name + "\n     " + e.message); }
}
function eq(actual, expected, msg) {
  const A = JSON.stringify(actual), B = JSON.stringify(expected);
  if (A !== B) throw new Error((msg ? msg + ": " : "") + "기대 " + B + " / 실제 " + A);
}
function ok(cond, msg) { if (!cond) throw new Error(msg || "조건 불만족"); }

// 팀 0: 리자몽(4→5→6)·피카츄(172→25)·이상해씨(1)·꼬부기(7)   팀 1: 리자몽·라이츄·이상해꽃·거북왕
function game(n, backdo) {
  return Y.newGame({
    pieces: n || 2, backdo: backdo !== false, seed: 7,
    teams: [{ name: "A", picks: [6, 25, 1, 7] }, { name: "B", picks: [6, 26, 3, 9] }],
  }, D.evoFrom);
}
// 말 i를 node 에 세운다 (via = 그 칸에 온 길)
function put(s, i, node, via) {
  const st = Y.settle(via || "OUT", node);
  Object.assign(s.pieces[i], { state: "board", route: st.route, step: st.step, atGoal: false });
  return s;
}
function choose(s, results, team) {
  s.phase = "choose"; s.pending = results.slice(); s.throwsLeft = 0; s.turn = team || 0;
  return s;
}
const move = (s, id) => Y.applyMove(s, id).state;
const node = (s, i) => Y.posOf(s.pieces[i]);
const ids = s => Y.legalMoves(s).map(m => m.id).sort();

// ---------- 13-1 표 ----------
t("1. 새 말 + 모 → 모(5)에 멈춰 대각선 길, 다음 도 → 20", () => {
  let s = move(choose(game(), [5]), "new/5");
  eq(node(s, 0), 5); eq(s.pieces[0].route, "A");
  s = move(choose(s, [1]), "n5/1");
  eq(node(s, 0), 20);
});
t("2. 새 말 + 윷 → 4, 다음 개 → 모를 지나 6 (바깥길 그대로)", () => {
  let s = move(choose(game(), [4]), "new/4");
  eq(node(s, 0), 4);
  s = move(choose(s, [2]), "n4/2");
  eq(node(s, 0), 6); eq(s.pieces[0].route, "OUT");
});
t("3. 뒷모(10)에 멈춤 → 걸 → 25·26 지나 방(22), 다음 도 → 27", () => {
  let s = put(game(), 0, 10);
  s = move(choose(s, [3]), "n10/3");
  eq(node(s, 0), 22);
  s = move(choose(s, [1]), "n22/1");
  eq(node(s, 0), 27);
});
t("4. 모 대각선에서 방(22)에 딱 멈춤 → 참먹이 쪽, 다음 도 → 27", () => {
  let s = put(game(), 0, 21);
  s = move(choose(s, [1]), "n21/1");
  eq(node(s, 0), 22); eq(s.pieces[0].route, "C");
  s = move(choose(s, [1]), "n22/1");
  eq(node(s, 0), 27);
});
t("5. 모 대각선에서 방을 지나감 → 23으로 직진", () => {
  let s = put(game(), 0, 21);
  s = move(choose(s, [2]), "n21/2");
  eq(node(s, 0), 23);
});
t("6. 1번 칸에서 빽도 → 참먹이 위, 다음 도 → 완주", () => {
  let s = put(game(), 0, 1);
  s = move(choose(s, [-1]), "n1/-1");
  eq(s.pieces[0].atGoal, true); eq(node(s, 0), 0); eq(s.pieces[0].state, "board");
  s = move(choose(s, [1]), "n0/1");
  eq(s.pieces[0].state, "done");
});
t("7. 판에 말 없음 + 빽도 → 쓸 수 없어 버리고 차례 넘김", () => {
  const r = Y.applyThrow(game(), -1);
  ok(r.events.some(e => e.type === "skip"), "skip 이벤트 없음");
  eq(r.state.turn, 1); eq(r.state.phase, "throw"); eq(r.state.pending, []);
});
t("8. 상대 업힌 말(2개) 잡기 → 둘 다 대기로, 한 번 더 던지기", () => {
  let s = game();
  put(s, 2, 3); put(s, 3, 3); // 팀 B 두 말 (piece 2·3)
  s = move(choose(s, [3]), "new/3");
  eq(s.pieces[2].state, "wait"); eq(s.pieces[3].state, "wait");
  eq(s.turn, 0, "잡은 팀이 계속"); eq(s.phase, "throw"); eq(s.throwsLeft, 1);
});
t("9. 내 말 위에 멈춤 → 업기 (같은 칸·같은 길). 방에서 B길 말 + C길 말 업기", () => {
  let s = put(game(), 0, 3);
  s = move(choose(s, [3]), "new/3");
  eq(node(s, 1), 3); eq(s.pieces[1].route, s.pieces[0].route); eq(s.pieces[1].step, s.pieces[0].step);
  eq(Y.unitsOf(s, 0).length, 1, "한 덩어리");
  // 방: piece 0 은 B로 와서 22(B,13), piece 1 은 21에서 도로 22 도착(C,8)
  s = game();
  Object.assign(s.pieces[0], { state: "board", route: "B", step: 13, atGoal: false });
  put(s, 1, 21);
  s = move(choose(s, [1]), "n21/1");
  eq([node(s, 0), node(s, 1)], [22, 22]);
  eq(s.pieces[0].route, s.pieces[1].route); eq(s.pieces[0].step, s.pieces[1].step);
  s = move(choose(s, [1]), "n22/1");
  eq([node(s, 0), node(s, 1)], [27, 27], "업힌 채로 같이 이동");
});
t("10. 윷·모·걸이 쌓이면 아무 순서로 쓸 수 있음", () => {
  let s = choose(game(4), [4, 5, 3]);
  eq(ids(s), ["new/3", "new/4", "new/5"]);
  s = move(s, "new/3");           // 걸 먼저 → 3
  eq(s.phase, "choose"); eq(s.pending, [4, 5]);
  s = move(s, "n3/5");            // 3 + 모 → 8
  eq(node(s, 0), 8);
  s = move(s, "n8/4");            // 8 + 윷 → 12
  eq(node(s, 0), 12); eq(s.turn, 1);
});
t("11. 도착 칸을 넘어서는 이동 → 완주", () => {
  let s = put(game(), 0, 19);
  s = move(choose(s, [3]), "n19/3");
  eq(s.pieces[0].state, "done");
});
t("12. 찌모(15)에서 빽도 — 바깥으로 온 말 14, 대각선으로 온 말 24", () => {
  let s = put(game(), 0, 15, "OUT");
  s = move(choose(s, [-1]), "n15/-1");
  eq(node(s, 0), 14);
  s = put(game(), 0, 15, "A");
  s = move(choose(s, [-1]), "n15/-1");
  eq(node(s, 0), 24);
});
t("13. 던지기 10만 번 — 결과 확률이 표와 ±0.5%p 안", () => {
  const P = Y.resultProbs(true);
  const table = { "-1": 0.0384, 1: 0.1152, 2: 0.3456, 3: 0.3456, 4: 0.1296, 5: 0.0256 };
  Object.keys(table).forEach(k => ok(Math.abs(P[k] - table[k]) < 1e-4, "확률 계산 " + k + ": " + P[k]));
  const N = 100000, cnt = {};
  let st = 12345;
  for (let i = 0; i < N; i++) { const r = Y.throwSticks(st, true); st = r.rng; cnt[r.result] = (cnt[r.result] || 0) + 1; }
  Object.keys(table).forEach(k => {
    const f = (cnt[k] || 0) / N;
    ok(Math.abs(f - table[k]) < 0.005, Y.RESULTS[k].name + " " + (f * 100).toFixed(2) + "% (기대 " + (table[k] * 100).toFixed(2) + "%)");
  });
  // 빽도를 끄면 빽도가 안 나옴
  st = 1;
  for (let i = 0; i < 20000; i++) { const r = Y.throwSticks(st, false); st = r.rng; ok(r.result !== -1, "빽도 꺼짐인데 빽도"); }
});
t("14. 진화 [4,5,6]: 5칸마다 (5칸 리자드 · 10칸 리자몽, 지름길이어도 칸 수대로), 빽도로 퇴화 안 함, 잡혀도 진화한 모습·칸 수 그대로", () => {
  let s = game();
  eq(s.teams[0].paths[0], [4, 5, 6]); eq(s.teams[0].paths[1], [172, 25]); eq(Y.evoPath(1, D.evoFrom), [1]);
  s = move(choose(s, [4]), "new/4");       // 4칸
  eq(Y.formOf(s, 0), 4); eq(s.pieces[0].walk, 4);
  s = move(choose(s, [1]), "n4/1");        // 5칸 (모) → 2단계
  eq(Y.formOf(s, 0), 5);
  s = move(choose(s, [4]), "n5/4");        // 모 대각선 → 23, 9칸
  eq(node(s, 0), 23); eq(Y.formOf(s, 0), 5);
  s = move(choose(s, [1]), "n23/1");       // 10칸 → 3단계
  eq(Y.formOf(s, 0), 6);
  s = move(choose(s, [-1]), "n24/-1");     // 빽도 → 23, 그대로 리자몽
  eq(Y.formOf(s, 0), 6); eq(s.pieces[0].walk, 10, "뒤로 간 칸은 빼지 않음");
  put(s, 2, 21);                           // 상대 말 21 → 개로 23 잡기
  s = move(choose(s, [2], 1), "n21/2");
  eq(s.pieces[0].state, "wait"); eq(Y.formOf(s, 0), 6, "잡혀도 리자몽 그대로"); eq(s.pieces[0].walk, 10, "온 칸 수도 그대로");
});
t("15. 한 팀이 전부 완주 → 판 끝, 이긴 팀 기록", () => {
  let s = put(put(game(), 0, 19), 1, 18);
  s = move(choose(s, [1, 2]), "n19/1");
  eq(s.phase, "choose");
  const r = Y.applyMove(s, "n18/2");
  eq(r.state.phase, "over"); eq(r.state.winner, 0);
  ok(r.events.some(e => e.type === "win"), "win 이벤트");
});

// ---------- 빽도로 물러난 뒤의 길 (스펙 초안의 SWITCH 표에 있던 버그) ----------
t("16. 모에서 빽도 → 4 → 개 → 6 (모를 지나가니 바깥길)", () => {
  let s = put(game(), 0, 5);
  s = move(choose(s, [-1]), "n5/-1");
  eq(node(s, 0), 4);
  s = move(choose(s, [2]), "n4/2");
  eq(node(s, 0), 6);
});
t("17. 뒷모에서 빽도 → 9 → 개 → 11 (바깥길)", () => {
  let s = put(game(), 0, 10);
  s = move(choose(s, [-1]), "n10/-1");
  eq(node(s, 0), 9);
  s = move(choose(s, [2]), "n9/2");
  eq(node(s, 0), 11);
});
t("18. 방(참먹이 쪽)에서 빽도 → 21 → 개 → 23 (방을 지나가니 직진)", () => {
  let s = put(game(), 0, 22, "A");
  eq(s.pieces[0].route, "C");
  s = move(choose(s, [-1]), "n22/-1");
  eq(node(s, 0), 21);
  s = move(choose(s, [2]), "n21/2");
  eq(node(s, 0), 23);
});
t("19. 23에서 빽도 → 방에 멈춤 → 다음 도는 참먹이 쪽(27)", () => {
  let s = put(game(), 0, 23);
  s = move(choose(s, [-1]), "n23/-1");
  eq(node(s, 0), 22);
  s = move(choose(s, [1]), "n22/1");
  eq(node(s, 0), 27);
});
t("20. 빽도로는 새 말을 못 내고, 참먹이 위의 말도 안 움직임", () => {
  let s = choose(game(), [-1]);
  eq(ids(s), []);
  s = game();
  Object.assign(s.pieces[0], { state: "board", route: "OUT", step: 0, atGoal: true });
  eq(ids(choose(s, [-1])), []);
});
t("21. 빽도로 참먹이에 가면 거기 서 있던 상대 말을 잡음", () => {
  let s = game();
  Object.assign(s.pieces[2], { state: "board", route: "OUT", step: 0, atGoal: true });
  put(s, 0, 1);
  s = move(choose(s, [-1]), "n1/-1");
  eq(s.pieces[2].state, "wait"); eq(s.phase, "throw");
});

// ---------- v2: ❓ 풀숲 칸 ----------
const withSpots = (spots, n) => Y.newGame({
  pieces: n || 2, backdo: true, seed: 7, spots,
  teams: [{ name: "A", picks: [6, 25, 1, 7] }, { name: "B", picks: [9, 26, 3, 133] }],
}, D.evoFrom);
const evTypes = r => r.events.map(e => e.type);
t("23. ❓ 칸에 딱 멈추면 야생 포켓몬(wild), 그 칸은 쓴 것으로", () => {
  let s = choose(withSpots([{ node: 3, id: 133 }, { node: 12, id: 58 }]), [3]);
  const r = Y.applyMove(s, "new/3");
  const w = r.events.find(e => e.type === "wild");
  ok(w, "wild 이벤트 없음");
  eq([w.node, w.id, w.team], [3, 133, 0]);
  eq(r.state.spots[0].used, true); eq(r.state.spots[1].used, false);
});
t("24. ❓ 칸을 지나가기만 하면 안 나옴", () => {
  const r = Y.applyMove(choose(withSpots([{ node: 3, id: 133 }]), [4]), "new/4");
  ok(!evTypes(r).includes("wild"), "지나갔는데 wild");
  eq(r.state.spots[0].used, false);
});
t("25. 한 칸에 한 번 — 다시 멈춰도 안 나옴", () => {
  let s = Y.applyMove(choose(withSpots([{ node: 3, id: 133 }]), [3]), "new/3").state;
  s.pieces[0].state = "wait"; // 말을 치우고 다른 말로 다시 3번 칸에
  const r = Y.applyMove(choose(s, [3]), "new/3");
  ok(!evTypes(r).includes("wild"), "두 번 나옴");
});
t("26. 골인하는 이동은 ❓ 칸을 지나도 안 나옴", () => {
  let s = put(withSpots([{ node: 19, id: 133 }]), 0, 17);
  const r = Y.applyMove(choose(s, [3]), "n17/3"); // 18 → 19 → 참먹이(골인)
  ok(r.events.some(e => e.type === "finish"), "골인 안 함");
  ok(!evTypes(r).includes("wild"), "골인인데 wild");
});
t("27. 배틀·진화와 겹치면 move → capture → evolve → wild 순서", () => {
  let s = withSpots([{ node: 8, id: 133 }]);
  put(s, 0, 4); s.pieces[0].walk = 1; // 리자몽 라인 말(파이리)이 4번 칸, 1칸 와 있음
  put(s, 2, 8);                  // 상대 말이 8번 칸 (❓ 칸)
  const r = Y.applyMove(choose(s, [4]), "n4/4"); // 8번 칸: 상대 잡기 + 5칸 → 리자드로 진화 + 풀숲
  const order = evTypes(r).filter(x => ["move", "capture", "evolve", "wild"].includes(x));
  eq(order, ["move", "capture", "evolve", "wild"]);
});
t("28. 옛 저장(❓ 칸 없음)도 이어하기 되고, 발동 안 함", () => {
  let s = game();
  delete s.spots;
  ok(Y.validate(s), "옛 저장 validate 실패");
  const r = Y.applyMove(choose(s, [3]), "new/3");
  ok(!evTypes(r).includes("wild"));
  s = withSpots([{ node: 3, id: 9999 }]);
  ok(!Y.validate(s), "이상한 포켓몬 번호를 통과시킴");
});
t("29. 보물상자 10만 번 — 50·30·10·5·5 (±0.5%p), 잡을 확률(일반) 80·85·90·95·100%", () => {
  const R = Y.Rewards;
  eq(R.BALLS.map(b => Math.round(R.catchRate(b) * 100)), [80, 85, 90, 95, 100]);
  const rnd = Y.rng(4242), cnt = {}, N = 100000;
  R.rollBox(N, rnd).forEach(b => { cnt[b] = (cnt[b] || 0) + 1; });
  const want = { poke: 0.5, great: 0.3, ultra: 0.1, luxury: 0.05, master: 0.05 };
  Object.keys(want).forEach(b => ok(Math.abs(cnt[b] / N - want[b]) < 0.005, R.BALL_INFO[b].name + " " + (cnt[b] / N * 100).toFixed(2) + "%"));
  eq(R.rollBox(3, rnd).length, 3);
});
t("30. 던지기 — 성공률이 잡을 확률과 같고, 흔들기는 성공 3번 · 실패 1~3번", () => {
  const R = Y.Rewards, rnd = Y.rng(77), N = 60000;
  ["poke", "ultra", "master"].forEach(b => {
    let okN = 0;
    for (let i = 0; i < N; i++) {
      const r = R.throwBall(b, rnd);
      if (r.ok) { okN++; ok(r.shakes === 3, "성공인데 흔들기 " + r.shakes); }
      else ok(r.shakes >= 1 && r.shakes <= 3, "실패 흔들기 " + r.shakes);
    }
    ok(Math.abs(okN / N - R.catchRate(b)) < 0.01, R.BALL_INFO[b].name + " 성공 " + (okN / N * 100).toFixed(1) + "%");
  });
});
t("31. 야생 포켓몬 — 희귀도 50·30·10·10 (±1%p), 아직 없는 포켓몬 먼저", () => {
  eq(Y.Rewards.WILD_ODDS, { c: 50, r: 30, u: 10, l: 10 });
  const pools = { c: [], r: [], u: [], l: [] };
  for (let id = 1; id <= 1025; id++) pools[D.rarity[id] || "c"].push(id);
  const R = Y.Rewards, rnd = Y.rng(9), N = 50000, cnt = { c: 0, r: 0, u: 0, l: 0 };
  for (let i = 0; i < N; i++) cnt[D.rarity[R.rollWild(pools, [], rnd)] || "c"]++;
  Object.keys(R.WILD_ODDS).forEach(k => ok(Math.abs(cnt[k] / N - R.WILD_ODDS[k] / 100) < 0.01, k + " " + (cnt[k] / N * 100).toFixed(1) + "%"));
  // 절반을 가지고 있으면: 절반 확률로 없는 것만 + 나머지 절반은 섞여서 → 없는 것 약 75%
  const owned = new Set();
  for (let id = 1; id <= 1025; id += 2) owned.add(id);
  let fresh = 0;
  for (let i = 0; i < N; i++) if (!owned.has(R.rollWild(pools, owned, rnd))) fresh++;
  ok(Math.abs(fresh / N - 0.75) < 0.02, "없는 포켓몬 " + (fresh / N * 100).toFixed(1) + "%");
});
t("32. ❓ 칸 고르기 — 2칸, 후보 칸 안에서, 서로 붙지 않게", () => {
  const rnd = Y.rng(3);
  for (let i = 0; i < 2000; i++) {
    const ns = Y.pickSpotNodes(rnd, 2);
    eq(ns.length, 2);
    ok(ns.every(n => Y.SPOT_NODES.includes(n)), "후보 밖 " + ns);
    ok(Math.abs(ns[0] - ns[1]) !== 1, "붙은 칸 " + ns); // 후보 칸은 모두 바깥 길이라 번호 차이 1 = 바로 옆 칸
  }
});

t("33. 진화 경로를 넘기면 그대로 — 스타팅 파이리가 리자몽까지 (사람 팀은 마지막 모습까지)", () => {
  const s = Y.newGame({ pieces: 2, seed: 1, teams: [
    { name: "A", picks: [4, 1], paths: [[4, 5, 6], [1, 2, 3]] },
    { name: "B", picks: [24, 109] },   // 넘기지 않으면 고른 모습까지 (로켓단)
  ] }, D.evoFrom);
  eq(s.teams[0].paths, [[4, 5, 6], [1, 2, 3]]);
  eq(s.teams[1].paths, [[23, 24], [109]]);
  ok(Y.validate(s));
});

// ---------- v3: ✨ 기술 · 🔄 말 바꾸기 ----------
const clone = o => JSON.parse(JSON.stringify(o));
// 기술이 있는 판: 팀 A(0) 는 기본으로 처음부터(early) 니트로차지, 팀 B(1) 는 철벽 후보·처음부터 아님
function sk(o) {
  o = o || {};
  return Y.newGame({
    pieces: o.n || 2, backdo: o.backdo !== false, seed: 5, skills: o.skills !== false,
    teams: [
      { name: "A", picks: [6, 25, 1, 7], pools: o.p0 || [["nitro"], ["nitro"], ["nitro"], ["nitro"]], now: o.e0 || [true, true, true, true] },
      { name: "B", picks: [9, 26, 3, 133], pools: o.p1 || [["iron"], ["iron"], ["iron"], ["iron"]], now: o.e1 || [false, false, false, false] },
    ],
  }, D.evoFrom);
}
// turnNo 를 정해 놓고 team 의 말 고르기 / 던지기 전 (효과가 몇 번째 차례까지 가는지 볼 때)
const at = (st, no, team, rs) => { const c = clone(st); c.turnNo = no; return choose(c, rs || [2], team); };
const atThrow = (st, no, team) => { const c = clone(st); c.turn = team; c.turnNo = no; c.phase = "throw"; c.throwsLeft = 1; c.pending = []; return c; };

t("34. 마지막 모습이 되면 기술을 배운다 · 시험용(now)은 처음부터 · 기술을 끄면 안 배움", () => {
  let s = sk();
  eq([s.pieces[0].skill, s.pieces[1].skill, s.pieces[2].skill], ["nitro", "nitro", null]);
  s = sk({ p1: [["surf", "splash"], ["surf"]] });
  put(s, 2, 8); s.pieces[2].walk = 8;
  const r = Y.applyMove(choose(s, [2], 1), "n8/2");   // 10칸 → 거북왕
  eq(evTypes(r).filter(x => x === "evolve" || x === "learn"), ["evolve", "learn"]);
  eq(Y.formOf(r.state, 2), 9); ok(["surf", "splash"].includes(r.state.pieces[2].skill));
  const s1 = Y.newGame({ pieces: 1, seed: 3, teams: [{ name: "A", picks: [128], pools: [["wish"]] }, { name: "B", picks: [4], paths: [[4, 5, 6]], pools: [["nitro"]] }] }, D.evoFrom);
  eq([s1.pieces[0].skill, s1.pieces[1].skill], [null, null], "진화하지 않는 켄타로스도 처음부터는 아님 (v4: 15칸)");
  eq(sk({ skills: false }).pieces[0].skill, null, "기술 끄기");
});
t("35. 기술은 판 위의 말만 · 말마다 한 판에 한 번 · 한 차례에 하나", () => {
  const s = sk();
  eq(Y.legalSkills(s), [], "집에 있으면 못 씀");
  put(s, 0, 3); put(s, 1, 7);
  eq(Y.legalSkills(s).map(x => x.piece), [0, 1]);
  const r = Y.applySkill(s, 0, null);
  eq(node(r.state, 0), 5, "니트로차지 = 바로 2칸");
  eq(Y.legalSkills(r.state), [], "한 차례에 하나");
  eq(r.state.pieces[0].used, true);
  eq(Y.legalSkills(atThrow(r.state, 3, 0)).map(x => x.piece), [1], "다음 차례: 쓴 말은 못 쓰고 다른 말은 씀");
});
t("36. 잡혀도 진화한 모습 그대로 · 안 쓴 기술도 남아서 판 위에 나가면 바로 쓴다", () => {
  let s = sk({ e0: [false, false], p0: [["nitro"], ["nitro"]] });
  put(s, 0, 9); s.pieces[0].walk = 9;
  s = move(choose(s, [1]), "n9/1");        // 10칸 → 리자몽 + 배움
  eq(Y.formOf(s, 0), 6); eq(s.pieces[0].skill, "nitro");
  put(s, 2, 8);
  s = move(choose(s, [2], 1), "n8/2");     // 상대가 잡음
  eq([s.pieces[0].state, Y.formOf(s, 0), s.pieces[0].skill, s.pieces[0].used, s.pieces[0].walk], ["wait", 6, "nitro", false, 10]);
  eq(Y.legalSkills(atThrow(s, 9, 0)), [], "집에 있으면 못 씀");
  put(s, 0, 3);
  eq(Y.legalSkills(atThrow(s, 9, 0)).map(x => x.piece), [0], "판 위에 나가면 바로 씀");
});
t("37. 말 바꾸기 — 그 자리·업힌 채로, 간 칸 수를 이어받아 곧바로 진화, 기술은 새로 · 같은 가족은 막기", () => {
  const s = sk({ e0: [false, false] });
  put(s, 0, 12); put(s, 1, 12);
  Object.assign(s.pieces[0], { walk: 12, stage: 2, skill: "nitro", used: true });
  const r = Y.applySwap(s, 0, { id: 133, path: [133, 134], base: 0, pool: ["surf"], early: false });
  const s2 = r.state;
  eq(node(s2, 0), 12); eq(Y.unitsOf(s2, 0).length, 1, "업힌 채로");
  eq([Y.formOf(s2, 0), s2.pieces[0].skill, s2.pieces[0].used, s2.teams[0].picks[0]], [134, null, false, 133], "2단계 이브이: 12칸이면 아직 기술 없음 (15칸)");
  eq(evTypes(r), ["swap", "evolve"]);
  const s4 = clone(s); s4.pieces[0].walk = 15;
  const r4 = Y.applySwap(s4, 0, { id: 133, path: [133, 134], base: 0, pool: ["surf"], early: false });
  eq([Y.formOf(r4.state, 0), r4.state.pieces[0].skill], [134, "surf"], "15칸 간 자리에 들어오면 곧바로 진화 + 기술");
  eq(evTypes(r4), ["swap", "evolve", "learn"]);
  ok(!Y.swapOk(s, 1, 7), "상대 팀 꼬부기 가족인데 바꿈");
  ok(Y.swapOk(s, 0, 4), "자기 가족(파이리 말 → 리자몽)은 됨");
  const s3 = sk({ e0: [false, false] });
  const r3 = Y.applySwap(s3, 0, { id: 5, path: [4, 5, 6], base: 1, pool: ["nitro"], early: false });
  eq([Y.formOf(r3.state, 0), r3.state.pieces[0].skill], [5, null], "집에 있는 말: 잡은 모습 그대로");
  eq(Y.applySwap(s3, 1, { id: 150, path: [150], base: 0, pool: ["future"], early: true }).state.pieces[1].skill, null, "전설도 바로는 아님 (15칸)");
  let threw = false;
  try { Y.applySwap(s, 1, { id: 8, path: [7, 8, 9], base: 1, pool: [] }); } catch (e) { threw = true; }
  ok(threw, "같은 가족 바꾸기를 막지 않음");
});
t("38. 니트로차지로 잡기 → 배틀·한 번 더 · 용의춤 = 1칸 + 한 번 더", () => {
  let s = sk(); put(s, 0, 3); put(s, 2, 5);
  let r = Y.applySkill(s, 0, null);
  eq(r.state.pieces[2].state, "wait"); ok(evTypes(r).includes("capture")); eq(r.state.throwsLeft, 2, "던지기 1 + 잡기 1");
  s = sk({ p0: [["ddance"], ["ddance"]] }); put(s, 0, 3);
  r = Y.applySkill(s, 0, null);
  eq([node(r.state, 0), r.state.throwsLeft, r.state.pieces[0].walk], [4, 2, 1]);
});
t("39. 공중날기 — 앞쪽 가장 가까운 모서리·방, 참먹이면 골인, 날아가니까 거미줄 무시", () => {
  const fly = () => sk({ p0: [["fly"], ["fly"]] });
  let s = fly(); put(s, 0, 2);
  const r = Y.applySkill(s, 0, null); eq([node(r.state, 0), r.state.pieces[0].route], [5, "A"]);
  s = fly(); put(s, 0, 21);
  eq(node(Y.applySkill(s, 0, null).state, 0), 22);
  s = fly(); put(s, 0, 17);
  eq(Y.applySkill(s, 0, null).state.pieces[0].state, "done");
  s = fly(); put(s, 0, 6); s.traps = [{ node: 8, kind: "web", team: 1 }];
  eq(node(Y.applySkill(s, 0, null).state, 0), 10);
});
t("40. 유턴 — 결과를 뒤로 써서 잡기 (칸 수엔 안 셈), 1칸째보다 뒤로는 안 감", () => {
  let s = sk({ p0: [["uturn"], ["uturn"]] });
  put(s, 0, 7); put(s, 2, 4);
  s = choose(s, [3]);
  eq(Y.legalSkills(s)[0].targets, [3]);
  let r = Y.applySkill(s, 0, 3);
  eq([node(r.state, 0), r.state.pieces[2].state, r.state.pending, r.state.pieces[0].walk], [4, "wait", [], 0]);
  s = sk({ p0: [["uturn"], ["uturn"]] }); put(s, 0, 2);
  r = Y.applySkill(choose(s, [5]), 0, 5);
  eq([node(r.state, 0), r.state.pieces[0].atGoal], [1, false]);
});
t("41. 파도타기 2칸 · 지진 모두 1칸 (한꺼번에) — 민 팀 말 앞에서 멈춤, 1칸째보다 뒤로 안 감, 풀숲 안 걸림", () => {
  const w = () => sk({ p0: [["surf"], ["quake"]] });
  let s = w(); s.spots = [{ node: 6, id: 133, used: false }];
  put(s, 0, 12); put(s, 2, 8); put(s, 3, 2);
  let r = Y.applySkill(s, 0, 8);
  eq(node(r.state, 2), 6); eq(r.state.spots[0].used, false, "밀려서는 풀숲 안 걸림");
  s = w(); put(s, 0, 7); put(s, 2, 8);
  ok(!Y.legalSkills(s).some(x => x.piece === 0), "바로 뒤가 민 팀 말이면 못 밈");
  s = w(); put(s, 1, 14); put(s, 2, 8); put(s, 3, 9);
  r = Y.applySkill(s, 1, null);
  eq([node(r.state, 2), node(r.state, 3)], [7, 8], "붙어 있던 말도 한꺼번에");
  s = w(); put(s, 1, 14); put(s, 3, 1); put(s, 2, 9);
  eq(node(Y.applySkill(s, 1, null).state, 3), 1);
});
t("42. 방전 — 판 위의 상대 말 모두 다음 차례 한 번 못 움직임 (새 말은 냄) · 수면가루 — 깰 확률 20% → 50%", () => {
  let s = sk({ p0: [["discharge"], ["sleep"]] });
  put(s, 0, 3); put(s, 2, 10);
  const s1 = Y.applySkill(s, 0, null).state;
  const b = at(s1, 2, 1);
  ok(!Y.legalMoves(b).some(m => m.unit === "n10"), "B 의 다음 차례에 움직임");
  ok(Y.legalMoves(b).some(m => m.unit === "new"), "새 말은 낼 수 있음");
  ok(Y.legalMoves(at(s1, 4, 1)).some(m => m.unit === "n10"), "그다음엔 움직여야 함");
  // 수면가루: 차례를 끝까지 넘기며 깨는지 본다
  const endT = st => { const t0 = st.turn; let evs = [], k = 0; while (st.turn === t0 && st.phase !== "over" && k++ < 20) { const r = st.phase === "throw" ? Y.applyThrow(st, 1) : Y.applyMove(st, Y.legalMoves(st)[0].id); evs = evs.concat(r.events); st = r.state; } return { s: st, evs }; };
  const N = 1500;
  let w1 = 0, w2 = 0, n2 = 0;
  for (let k = 0; k < N; k++) {
    s = sk({ p0: [["sleep"], ["nitro"]] }); put(s, 0, 3); put(s, 1, 7); put(s, 2, 10);
    s.srng = ((k + 1) * 2654435761 >>> 0) || 1;
    const e1 = endT(Y.applySkill(s, 0, 10).state);
    const a = e1.evs.find(e => e.type === "wake");
    ok(a && a.chance === 0.2, "첫 번째 차례 20%");
    const canMove = st => Y.legalMoves(Y.applyThrow(st, 2).state).some(m => m.unit === "n10");
    if (a.ok) { w1++; ok(canMove(e1.s), "깨면 그 차례부터 움직임"); continue; }
    ok(!canMove(e1.s), "안 깨면 못 움직임");
    const e3 = endT(endT(e1.s).s);
    const b2 = e3.evs.find(e => e.type === "wake");
    ok(b2 && b2.chance === 0.5, "두 번째 차례 50%");
    n2++;
    if (b2.ok) { w2++; ok(canMove(e3.s)); continue; }
    ok(!canMove(e3.s));
    const e5 = endT(endT(e3.s).s);
    ok(!e5.evs.some(e => e.type === "wake") && canMove(e5.s), "세 번째엔 저절로 깸");
  }
  ok(Math.abs(w1 / N - 0.2) < 0.035, "첫 번째 깸 " + w1 / N);
  ok(Math.abs(w2 / n2 - 0.5) < 0.05, "두 번째 깸 " + w2 / n2);
});
t("43. 오로라베일 — 상대 차례 두 번 동안 그 칸에 못 멈추고 기술도 안 맞음", () => {
  const s = sk({ p0: [["veil"], ["veil"]], p1: [["surf"], ["surf"]], e1: [true, true] });
  put(s, 0, 8); put(s, 2, 6); put(s, 3, 3);
  const s1 = Y.applySkill(s, 0, null).state;
  [2, 4].forEach(no => {
    ok(!Y.legalMoves(at(s1, no, 1)).some(m => m.to && m.to.node === 8), "차례 " + no + ": 장막 칸에 멈춤");
    ok(!Y.legalSkills(atThrow(s1, no, 1)).some(x => x.targets.indexOf(8) >= 0), "차례 " + no + ": 장막 말을 밈");
  });
  ok(Y.legalMoves(at(s1, 6, 1)).some(m => m.to && m.to.node === 8), "세 번째엔 풀림");
});
t("44. 맹독(다음 윷 빽도, 빽도 끈 판은 도) · 튀어오르기(반은 그대로, 반은 4칸 점프) · 예전 비바라기는 튀어오르기로", () => {
  let s = sk({ p0: [["toxic"], ["splash"]] }); put(s, 0, 3); put(s, 1, 4);
  let s1 = Y.applySkill(s, 0, null).state;
  eq(s1.teams[1].fx.poison, true);
  let r = Y.applyThrow(atThrow(s1, 2, 1), 3);
  eq([r.events[0].result, r.events[0].poisoned, r.state.teams[1].fx.poison], [-1, true, false]);
  s = sk({ p0: [["toxic"], ["splash"]], backdo: false }); put(s, 0, 3);
  eq(Y.applyThrow(atThrow(Y.applySkill(s, 0, null).state, 2, 1), 3).events[0].result, 1);
  // 🐟 튀어오르기 (영어판 2026-10-10, 비바라기 대신): 반은 아무 일 없음, 반은 4칸 점프 — 기술 난수(srng)로
  s = sk({ p0: [["toxic"], ["splash"]] }); put(s, 1, 4);
  let hops = 0, stays = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const c = clone(s); c.srng = seed * 7919;
    const rr = Y.applySkill(c, 1, null);
    const sp = rr.events.find(e => e.type === "splash");
    ok(sp, "splash 사건");
    if (sp.hop) { hops++; eq(Y.posOf(rr.state.pieces[1]), 8, "4칸 점프"); }
    else { stays++; eq(Y.posOf(rr.state.pieces[1]), 4, "아무 일 없음"); }
    eq(rr.state.pieces[1].used, true, "한 번 쓰면 끝");
  }
  ok(hops > 60 && stays > 60, "반반쯤: 점프 " + hops + " · 그대로 " + stays);
  eq(Y.upgrade(Object.assign(clone(s), { kSplash: false })).teams[0].pools[1][0], "splash");
  const old = clone(s); delete old.kSplash; old.pieces[1].skill = "splash"; old.teams[0].pools[1] = ["splash"];
  const up = Y.upgrade(old);
  eq([up.pieces[1].skill, up.teams[0].pools[1][0]], ["splash", "splash"], "예전 판의 비바라기는 튀어오르기로");
});
t("45. 미래예지(맞히면 한 번 더) · 희망사항(원하는 결과, 한 번 더 없음) · 성장(한 단계, 모는 못 올림)", () => {
  let s = sk({ p0: [["future"], ["wish"]] }); put(s, 0, 3); put(s, 1, 4);
  const s1 = Y.applySkill(s, 0, 2).state;
  let r = Y.applyThrow(s1, 2);
  ok(r.events.some(e => e.type === "foresee" && e.ok)); eq([r.state.throwsLeft, r.state.phase], [1, "throw"]);
  r = Y.applyThrow(s1, 3);
  ok(r.events.some(e => e.type === "foresee" && !e.ok)); eq(r.state.phase, "choose");
  const s2 = Y.applySkill(s, 1, 5).state;
  eq([s2.pending, s2.throwsLeft, s2.phase], [[5], 0, "choose"], "모를 골라도 한 번 더 없음");
  s = sk({ p0: [["growth"], ["growth"]] }); put(s, 0, 3);
  s = choose(s, [3, 2]);
  eq(Y.legalSkills(s)[0].targets, [0, 1]);
  r = Y.applySkill(s, 0, 0);
  eq([r.state.pending, r.state.throwsLeft], [[4, 2], 0], "기술로 만든 윷은 한 번 더 없음");
  s = sk({ p0: [["growth"], ["growth"]] }); put(s, 0, 3); s = choose(s, [5, -1]);
  eq(Y.legalSkills(s)[0].targets, [1]);
  eq(Y.applySkill(s, 0, 1).state.pending, [5, 1]);
});
t("46. 스텔스록 — 상대가 멈추면 집으로 (지나가면·우리 말은 괜찮음) · 끈적끈적네트 — 지나가다 걸려 멈춤", () => {
  let s = sk({ p0: [["rock"], ["web"]] }); put(s, 0, 3); put(s, 1, 4);
  let s1 = Y.applySkill(s, 0, 9).state;
  eq(s1.traps, [{ node: 9, kind: "rock", team: 0 }]);
  put(s1, 2, 7);
  const b = at(s1, 2, 1, [2, 3]);
  ok(Y.legalMoves(b).find(m => m.id === "n7/2").rock, "미리보기에 바위 표시");
  let r = Y.applyMove(b, "n7/2");
  eq([r.state.pieces[2].state, r.state.traps], ["wait", []]); ok(evTypes(r).includes("rock"));
  r = Y.applyMove(b, "n7/3");
  eq([node(r.state, 2), r.state.traps.length], [10, 1], "지나가면 안 걸림");
  r = Y.applyMove(at(s1, 3, 0, [5]), "n4/5");
  eq(node(r.state, 1), 9, "우리 바위는 괜찮음");
  s = sk({ p0: [["rock"], ["web"]] }); put(s, 1, 4);
  s1 = Y.applySkill(s, 1, 9).state;
  put(s1, 2, 7);
  r = Y.applyMove(at(s1, 2, 1, [4]), "n7/4");
  eq([node(r.state, 2), r.state.traps], [9, []]); ok(evTypes(r).includes("webstop"));
});
t("47. 원한(상대 기술 봉인 세 번, 저절로 기술도) · 가로챈다(빼앗은 기술은 내 것)", () => {
  let s = sk({ p0: [["spite"], ["snatch"]], p1: [["nitro"], ["iron"]], e1: [true, true] });
  put(s, 0, 3); put(s, 1, 9); put(s, 2, 10); put(s, 3, 12);
  const s1 = Y.applySkill(s, 0, null).state;
  eq(Y.legalSkills(atThrow(s1, 2, 1)), []); eq(Y.legalSkills(atThrow(s1, 6, 1)), []);
  eq(Y.legalSkills(atThrow(s1, 8, 1)).map(x => x.piece), [2]);
  eq(Y.applyMove(at(s1, 3, 0, [3]), "n9/3").state.pieces[3].state, "wait", "봉인 중엔 철벽이 안 나감");
  eq(Y.applyMove(at(s1, 9, 0, [3]), "n9/3").state.pieces[3].state, "board", "봉인이 풀리면 철벽");
  s = sk({ p0: [["spite"], ["snatch"]], p1: [["nitro"], ["iron"]], e1: [true, true] });
  put(s, 1, 4); put(s, 2, 10);
  eq(Y.legalSkills(s).find(x => x.piece === 1).targets, [2, 3]);
  const s2 = Y.applySkill(s, 1, 2).state;
  eq([s2.pieces[1].skill, s2.pieces[1].used, s2.pieces[2].used], ["nitro", false, true]);
});
t("48. 화염방사 — 앞쪽 3칸 안의 상대를 집으로 + 한 번 더 (쏜 말은 제자리) · 철벽이면 막힘", () => {
  let s = sk({ p0: [["flame"], ["flame"]] }); put(s, 0, 3); put(s, 2, 6); put(s, 3, 8);
  eq(Y.legalSkills(s)[0].targets, [6]);
  let r = Y.applySkill(s, 0, 6);
  eq([r.state.pieces[2].state, node(r.state, 0), r.state.throwsLeft], ["wait", 3, 2]);
  const cap = r.events.find(e => e.type === "capture"); ok(cap.remote && cap.skill === "flame");
  s = sk({ p0: [["flame"], ["flame"]], p1: [["iron"], ["iron"]], e1: [true, true] }); put(s, 0, 3); put(s, 2, 5);
  r = Y.applySkill(s, 0, 5);
  eq([r.state.pieces[2].state, r.state.pieces[2].used], ["board", true]); ok(evTypes(r).includes("block"));
});
t("49. 순풍 — 우리 말 모두 한 칸 (잡지 않음, 업힘) · 사이드체인지 — 우리 말 ↔ 상대 말", () => {
  let s = sk({ n: 3, p0: [["tailwind"], ["nitro"], ["nitro"]] });
  put(s, 0, 3); put(s, 1, 6); put(s, 2, 12); put(s, 3, 4); put(s, 4, 13);
  let r = Y.applySkill(s, 0, null);
  eq([node(r.state, 0), node(r.state, 1), node(r.state, 2)], [3, 7, 12]);
  eq(r.state.pieces[3].state, "board", "순풍으로는 안 잡음");
  s = sk({ n: 3, p0: [["tailwind"], ["nitro"], ["nitro"]] }); put(s, 0, 6); put(s, 1, 7); put(s, 3, 8);
  r = Y.applySkill(s, 0, null);
  eq(Y.unitsOf(r.state, 0).length, 1, "업힘"); ok(evTypes(r).includes("stack"));
  s = sk({ n: 3, p0: [["nitro"], ["allyswitch"], ["nitro"]] }); put(s, 1, 3); put(s, 2, 12); put(s, 4, 14);
  eq(Y.legalSkills(s).find(x => x.piece === 1).targets, [14], "v8: 상대 말만 고름");
  r = Y.applySkill(s, 1, 14);
  eq([node(r.state, 1), node(r.state, 4), node(r.state, 2)], [14, 3, 12]);
  ok(!evTypes(r).includes("capture"), "바꾸기는 잡기 없음");
});
t("50. 손가락흔들기 — 지금 쓸 수 있는 누르는 기술 중 무작위 (자기 자신·유턴·저절로 기술은 안 나옴)", () => {
  const seen = {};
  for (let seed = 1; seed <= 300; seed++) {
    const s = sk({ p0: [["metronome"], ["nitro"]] });
    s.srng = seed;
    put(s, 0, 3); put(s, 2, 5);
    const r = Y.applySkill(s, 0, null);
    const m = r.events.find(e => e.type === "metronome");
    ok(m && Y.SKILLS[m.key].kind === "active" && m.key !== "metronome" && m.key !== "uturn", "이상한 기술 " + (m && m.key));
    seen[m.key] = 1;
    ok(Y.validate(r.state), "validate " + m.key);
  }
  ok(Object.keys(seen).length >= 10, "여러 기술이 나와야 함: " + Object.keys(seen).join(","));
});
t("51. 카운터 — 방해 기술을 되돌림 (파도타기 → 쓴 말이 밀림 · 맹독 → 쓴 팀이 빽도 · 가로챈다 → 막기)", () => {
  const c = () => sk({ p0: [["surf"], ["toxic"]], p1: [["counter"], ["counter"]], e1: [true, true] });
  let s = c(); put(s, 0, 9); put(s, 1, 4); put(s, 2, 6); put(s, 3, 14);
  let r = Y.applySkill(s, 0, 6);
  eq([node(r.state, 2), node(r.state, 0)], [6, 7], "상대는 그대로, 쓴 말이 2칸 밀림");
  ok(evTypes(r).includes("reflect"));
  eq([2, 3].filter(j => r.state.pieces[j].used).length, 1, "카운터는 하나만 씀");
  s = c(); put(s, 1, 4); put(s, 2, 6);
  r = Y.applySkill(s, 1, null);
  eq([r.state.teams[0].fx.poison, !!r.state.teams[1].fx.poison], [true, false]);
  s = sk({ p0: [["snatch"], ["snatch"]], p1: [["counter"], ["nitro"]], e1: [true, true] }); put(s, 0, 4); put(s, 2, 6); put(s, 3, 8);
  r = Y.applySkill(s, 0, 3);
  eq([r.state.pieces[3].skill, r.state.pieces[3].used, r.state.pieces[0].skill], ["nitro", false, "snatch"]);
});
t("52. 철벽(튕겨 냄, 한 번 더 없음) · 달빛(집 대신 한 칸 뒤로) · 길동무(잡은 말도 집으로)", () => {
  const g2 = p1 => sk({ p1, e1: [true, true] });
  let s = g2([["iron"], ["moon"]]); put(s, 0, 4); put(s, 2, 7);
  let r = Y.applyMove(choose(s, [3]), "n4/3");
  eq([node(r.state, 0), r.state.pieces[2].state, r.state.pieces[0].walk], [4, "board", 0], "온 자리로, 칸도 안 셈");
  ok(evTypes(r).includes("block") && !evTypes(r).includes("bonus"), "한 번 더 없음");
  s = g2([["iron"], ["moon"]]); put(s, 2, 3);
  eq(Y.applyMove(choose(s, [3]), "new/3").state.pieces[0].state, "wait", "새 말은 집으로 되돌아감");
  s = g2([["iron"], ["moon"]]); put(s, 0, 4); put(s, 3, 7);
  r = Y.applyMove(choose(s, [3]), "n4/3");
  eq([node(r.state, 3), node(r.state, 0)], [6, 7]); ok(evTypes(r).includes("moon"));
  s = g2([["iron"], ["moon"]]); put(s, 0, 4); put(s, 1, 6); put(s, 3, 7);
  eq(node(Y.applyMove(choose(s, [3]), "n4/3").state, 3), 5, "뒤 칸에 상대 말이 있으면 더 뒤로");
  s = g2([["bond"], ["bond"]]); put(s, 0, 4); put(s, 2, 7);
  r = Y.applyMove(choose(s, [3]), "n4/3");
  eq([r.state.pieces[2].state, r.state.pieces[0].state], ["wait", "wait"]); ok(evTypes(r).includes("bond"));
});
t("53. 옛 저장(v1, 기술 전) → 기술 없이 이어 하기", () => {
  const old = clone(game());
  old.v = 1;
  ["traps", "skillTurn", "srng", "guess"].forEach(k => delete old[k]); delete old.settings.skills;
  old.teams.forEach(tm => { delete tm.pools; delete tm.early; delete tm.fx; });
  old.pieces.forEach(p => { delete p.walk; delete p.base; delete p.skill; delete p.used; delete p.fx; });
  Object.assign(old.pieces[0], { state: "board", step: 7 });
  ok(!Y.validate(old), "v1 그대로 통과");
  const u = Y.upgrade(old);
  ok(Y.validate(u), "올린 뒤 validate 실패");
  eq([u.settings.skills, u.pieces[0].walk, Y.legalSkills(u)], [false, 7, []]);
  ok(Y.validate(Y.applyMove(choose(u, [2]), "n7/2").state));
});
t("54. 로켓단이 잡은 포켓몬을 넣는 말 — 기술 다 쓴 말 → 집에 있는 말 → 멈춘 말, 같은 가족이면 없음", () => {
  const s = sk({ n: 3 });
  put(s, 3, 5); put(s, 4, 8);
  Object.assign(s.pieces[4], { skill: "nitro", used: true });
  eq(Y.cpuSwapTarget(s, 1, 133, 3), 4);
  s.pieces[4].used = false;
  eq(Y.cpuSwapTarget(s, 1, 133, 3), 5, "집에 있는 말");
  put(s, 5, 10);
  eq(Y.cpuSwapTarget(s, 1, 133, 3), 3, "멈춘 말");
  eq(Y.cpuSwapTarget(s, 1, 4, 3), null, "파이리 가족이 판에 있으면 못 넣음");
});
t("55. 로켓단 기술 — 쉬움은 방해 기술을 안 쓰고 가끔만, 보통은 잡을 수 있으면 화염방사", () => {
  const s = sk({ p0: [["flame"], ["surf"]] }); put(s, 0, 3); put(s, 1, 12); put(s, 2, 5); put(s, 3, 13);
  let rs = 1; const rnd = () => { const r = Y.rand(rs); rs = r[1]; return r[0]; };
  for (let k = 0; k < 200; k++) { const a = Y.cpuSkill(s, "easy", rnd); ok(!a, "쉬움이 방해 기술을 씀: " + (a && a.key)); }
  let hits = 0;
  for (let k = 0; k < 200; k++) { const a = Y.cpuSkill(s, "normal", rnd); if (a) { ok(a.key === "flame" && a.target === 5, "보통의 선택 " + JSON.stringify(a)); hits++; } }
  ok(hits > 100, "보통이 거의 안 씀 " + hits);
  const e = sk({ p0: [["nitro"], ["ddance"]] }); put(e, 0, 3); put(e, 1, 12);
  let used = 0;
  for (let k = 0; k < 300; k++) if (Y.cpuSkill(e, "easy", rnd)) used++;
  ok(used > 40 && used < 150, "쉬움은 가끔(30%) " + used);
});
t("56. 기술을 아무렇게나 쓰는 무작위 3,000판 — 한 칸에 두 팀 없음, 1칸째보다 뒤로 밀린 말 없음, 효과는 끝남, 판도 끝남", () => {
  const typeOf = id => String(D.types[id - 1] || "노말").split("·");
  const poolOf = id => [...new Set([].concat(...typeOf(id).map(tp => Y.TYPE_SKILLS[tp] || [])))];
  const allKeys = Object.keys(Y.SKILLS);
  let rs = 4321;
  const rnd = () => { const r = Y.rand(rs); rs = r[1]; return r[0]; };
  const usedKeys = {}, reacted = {};
  let gifted = 0;
  let longest = 0;
  for (let g = 0; g < 3000; g++) {
    const n = 2 + (g % 3);
    const mk = (name, picks) => ({ name, picks, rar: g % 2 ? picks.map((_, k) => "crul"[(g + k) % 4]) : undefined, types: g % 2 ? picks.map(id => Y.evoPath(id, D.evoFrom).map(typeOf)) : undefined, pools: picks.map((id, k) => g % 3 === 0 ? [allKeys[(Math.floor(g / 3) + k * 9 + (name === "B" ? 4 : 0)) % allKeys.length]] : poolOf(id)), now: picks.map((_, k) => g % 3 === 0 || (g + k) % 3 === 0) }); // 기술을 정해 준 판(g%3==0)은 모두 처음부터
    const spotRnd = Y.rng(g + 100);
    let s = Y.newGame({
      pieces: n, backdo: g % 4 !== 0, seed: g + 1, first: g % 2, skills: true,
      spots: g % 2 ? Y.pickSpotNodes(spotRnd, 2).map(nd => ({ node: nd, id: 1 + Math.floor(spotRnd() * 1025) })) : undefined,
      teams: [mk("A", [6, 25, 1, 7]), mk("B", [9, 26, 3, 133])],
    }, D.evoFrom);
    let steps = 0;
    while (s.phase !== "over") {
      if (++steps > 3000) throw new Error("끝나지 않는 판 (seed " + (g + 1) + ")");
      const sks = Y.legalSkills(s);
      let r;
      if (sks.length && rnd() < 0.5) {
        const x = sks[Math.floor(rnd() * sks.length)];
        r = Y.applySkill(s, x.piece, x.targets[Math.floor(rnd() * x.targets.length)], x.slot);
        usedKeys[x.key] = 1;
      } else if (s.phase === "throw") r = Y.applyThrow(s);
      else {
        const ms = Y.legalMoves(s);
        ok(ms.length > 0, "choose 인데 둘 수가 없음");
        r = Y.applyMove(s, (g % 2 ? Y.cpuChoose(s, "normal", rnd) : ms[Math.floor(rnd() * ms.length)]).id);
      }
      r.events.forEach(e => { if (["block", "moon", "bond", "reflect", "skillfail", "reactfail", "wake"].includes(e.type)) reacted[e.type] = 1; });
      s = r.state;
      while (s.gifts && s.gifts.length && s.phase !== "over") { // 🎁 받을 팀원을 아무렇게나 고른다
        const c = Y.giftTargets(s, s.gifts[0].team);
        s = Y.applyGift(s, c[Math.floor(rnd() * c.length)]).state; gifted++;
      }
      if (g % 7 === 0 && rnd() < 0.03) {
        const cand = s.pieces.map((p, i) => i).filter(i => Y.swapOk(s, i, 133));
        if (cand.length) s = Y.applySwap(s, cand[Math.floor(rnd() * cand.length)], { id: 133, path: [133, 134], base: 0, pool: ["surf", "splash"], early: false }).state;
      }
      ok(Y.validate(s), "validate 실패");
      const where = {};
      s.pieces.forEach(p => {
        if (p.state !== "board") return;
        const nd = Y.posOf(p);
        if (where[nd]) {
          ok(where[nd].team === p.team, "칸 " + nd + "에 두 팀");
          ok(where[nd].route === p.route && where[nd].step === p.step && where[nd].atGoal === p.atGoal, "업힌 말의 길이 다름");
        } else where[nd] = p;
        ok(p.atGoal || p.step >= 1, "1칸째보다 뒤");
        const f = p.fx || {};
        ["para", "sleep", "veil", "freeze", "tired", "spike", "dig"].forEach(k => ok(!f[k] || f[k] <= s.turnNo + 8, "끝나지 않는 효과 " + k));
        Y.COUNT_KEYS.concat(["confuse"]).forEach(k => ok(!f[k] || (f[k] >= 1 && f[k] <= 2), "횟수 효과 " + k));
        ok(p.stage < s.teams[p.team].paths[p.slot].length, "진화 단계 범위");
      });
      s.teams.forEach(tm => ok(!(tm.fx || {}).mist || tm.fx.mist <= s.turnNo + 8, "끝나지 않는 미스트필드"));
      ok(s.psych == null || s.phase === "throw", "자기암시는 던지기 전에만 남음");
    }
    ok(Y.teamDone(s, s.winner), "이긴 팀 말이 다 안 들어옴");
    longest = Math.max(longest, steps);
  }
  eq(allKeys.filter(k => Y.SKILLS[k].kind === "active" && !usedKeys[k]), [], "한 번도 안 쓰인 기술");
  eq(Object.keys(reacted).sort(), ["block", "bond", "moon", "reactfail", "reflect", "skillfail", "wake"], "저절로 기술·실패·깨기가 다 나와야 함");
  ok(gifted > 100, "받은 기술 넘기기가 판에서 일어남: " + gifted);
  console.log("     (가장 긴 판: 동작 " + longest + "번)");
});

// ---------- v4: ✨ 15칸 규칙 · 🎓 시계·돈 문제 ----------
t("57. 기술 쓰는 때 — 3단계는 마지막 모습(10칸) · 진화 없음·2단계·전설은 15칸", () => {
  const s = Y.newGame({ pieces: 4, seed: 9, skills: true, teams: [
    { name: "A", picks: [6, 25, 128, 150], paths: [[4, 5, 6], [172, 25], [128], [150]], pools: [["nitro"], ["surf"], ["wish"], ["future"]], early: [false, false, false, true] },
    { name: "B", picks: [9, 26, 3, 133], pools: [["iron"], ["iron"], ["iron"], ["iron"]] },
  ] }, D.evoFrom);
  eq(s.pieces.slice(0, 4).map(p => p.skill), [null, null, null, null], "처음엔 아무도 없음");
  const walkTo = (st, i, n) => { Object.assign(st.pieces[i], { state: "board", atGoal: false, walk: n - 1 }, Y.settle("OUT", 9)); return Y.applyMove(choose(st, [1]), "n9/1").state; };
  let a = walkTo(clone(s), 0, 10); eq([Y.formOf(a, 0), a.pieces[0].skill], [6, "nitro"], "3단계: 10칸");
  a = walkTo(clone(s), 1, 10); eq([Y.formOf(a, 1), a.pieces[1].skill], [25, null], "2단계: 10칸은 아직");
  a = walkTo(clone(s), 1, 15); eq(a.pieces[1].skill, "surf", "2단계: 15칸");
  a = walkTo(clone(s), 2, 14); eq(a.pieces[2].skill, null, "진화 없음: 14칸은 아직");
  a = walkTo(clone(s), 2, 15); eq(a.pieces[2].skill, "wish", "진화 없음: 15칸");
  a = walkTo(clone(s), 3, 15); eq(a.pieces[3].skill, "future", "전설: 15칸");
  eq([Y.needsWalk(s, 0), Y.needsWalk(s, 1), Y.needsWalk(s, 2), Y.needsWalk(s, 3)], [false, true, true, true]);
});
t("58. 시계 문제 — 보기 4개, 정답 하나, 단계별 시각 (정각·30분 / 5분 / 1분), 아이가 하는 실수가 오답에", () => {
  const S = Y.Study, rnd = Y.rng(11);
  for (let k = 0; k < 3000; k++) {
    const lv = 1 + (k % 3), q = S.clock(lv, rnd);
    eq(q.choices.length, 4, "보기 수");
    ok(new Set(q.choices.map(S.clockText)).size === 4, "보기가 겹침 " + q.choices.map(S.clockText));
    ok(q.choices[q.answer].h === q.h && q.choices[q.answer].m === q.m, "정답 위치");
    ok(q.choices.every(c => c.h >= 1 && c.h <= 12 && c.m >= 0 && c.m < 60), "이상한 시각");
    if (lv === 1) ok(q.m === 0 || q.m === 30, "1단계 " + q.m);
    if (lv === 2) ok(q.m % 5 === 0, "2단계 " + q.m);
    if (lv === 3) ok(q.m % 5 !== 0, "3단계 " + q.m);
  }
  const q = S.clock(2, rnd, { h: 3, m: 40 });
  eq(q.choices.map(S.clockText).sort(), ["3:08", "3:40", "4:40", "8:15"], "3시 40분의 오답 = 다음 시 · 바늘 바꿔 읽기 · 숫자 그대로");
  eq(S.clockText({ h: 7, m: 0 }), "7 o'clock"); eq(S.clockText({ h: 12, m: 5 }), "12:05");
});
t("59. 돈 문제 — 합이 정확, 보기 4개, 단계별 단위 (천·백 / +만 / +십만), 자릿값 실수가 오답에", () => {
  const S = Y.Study, rnd = Y.rng(12);
  for (let k = 0; k < 3000; k++) {
    const lv = 1 + (k % 3), q = S.money(lv, rnd);
    eq(q.total, 100000 * q.counts[100000] + 10000 * q.counts[10000] + 1000 * q.counts[1000] + 100 * q.counts[100], "합");
    eq(q.choices.length, 4); ok(new Set(q.choices).size === 4, "보기가 겹침"); eq(q.choices[q.answer], q.total);
    ok(S.UNITS.every(u => q.counts[u] >= 0 && q.counts[u] <= 9), "한 단위 0~9장");
    const top = { 1: 1000, 2: 10000, 3: 100000 }[lv];
    ok(q.counts[top] >= 1 && S.UNITS.filter(u => u > top).every(u => q.counts[u] === 0), lv + "단계 가장 큰 단위 " + JSON.stringify(q.counts));
  }
  const q = S.money(2, rnd, { 10000: 3, 1000: 2, 100: 5 });
  eq(q.total, 32500);
  ok(q.choices.includes(3250) && q.choices.includes(325000) && q.choices.includes(23500), "자릿값 오답 " + q.choices);
  eq([32500, 10000, 1000, 110000, 999900, 2100, 15000, 700400].map(S.koNum),
    ["thirty-two thousand five hundred", "ten thousand", "one thousand", "one hundred ten thousand",
     "nine hundred ninety-nine thousand nine hundred", "two thousand one hundred", "fifteen thousand", "seven hundred thousand four hundred"]);
  eq([S.won(32500), S.won(100), S.won(999900)], ["32,500 won", "100 won", "999,900 won"]);
});
t("60. 어려움 자동 오르내림 — 3번 연속 맞히면 위, 2번 연속 틀리면 아래 (1~3단계)", () => {
  const S = Y.Study;
  let st = S.record(null, true); st = S.record(st, true); eq(st.level, 1); st = S.record(st, true); eq(st.level, 2);
  st = S.record(st, false); eq(st.level, 2); st = S.record(st, false); eq(st.level, 1);
  st = S.record(st, false); st = S.record(st, false); eq(st.level, 1, "1단계 아래로는 안 감");
  for (let k = 0; k < 12; k++) st = S.record(st, true);
  eq(st.level, 3, "3단계 위로는 안 감"); eq([st.right, st.total], [15, 19]);
});
t("61. 시계를 맞히면 풀숲 희귀도 30·30·20·20 (±1%p) · 풀숲 포켓몬을 나중에 뽑는 판(id 없음)도 저장·검사 통과", () => {
  eq(Y.Rewards.WILD_ODDS_BOOST, { c: 30, r: 30, u: 20, l: 20 });
  const pools = { c: [], r: [], u: [], l: [] };
  for (let id = 1; id <= 1025; id++) pools[D.rarity[id] || "c"].push(id);
  const rnd = Y.rng(21), N = 50000, cnt = { c: 0, r: 0, u: 0, l: 0 };
  for (let i = 0; i < N; i++) cnt[D.rarity[Y.Rewards.rollWild(pools, [], rnd, Y.Rewards.WILD_ODDS_BOOST)] || "c"]++;
  Object.keys(cnt).forEach(k => ok(Math.abs(cnt[k] / N - Y.Rewards.WILD_ODDS_BOOST[k] / 100) < 0.01, k + " " + (cnt[k] / N * 100).toFixed(1) + "%"));
  const s = withSpots([{ node: 3, id: null }, { node: 12, id: null }]);
  ok(Y.validate(s), "id 없는 풀숲");
  const r = Y.applyMove(choose(s, [3]), "new/3");
  const w = r.events.find(e => e.type === "wild");
  ok(w && w.id == null && Y.validate(r.state), "id 없이 wild 이벤트 → 화면이 문제를 낸 뒤 뽑는다");
});

t("62. 잡을 확률 — 몬스터볼 기준 일반 80 · 레어 70 · 유니크 60 · 전설 40, 볼 단계 +5, 놓칠 때마다 +10, 마스터볼 100", () => {
  const R = Y.Rewards;
  eq(["c", "r", "u", "l"].map(k => Math.round(R.catchRate("poke", k) * 100)), [80, 70, 60, 40]);
  eq(R.BALLS.map(b => Math.round(R.catchRate(b, "l") * 100)), [40, 45, 50, 55, 100], "전설: 볼 단계마다 +5");
  eq([0, 1, 2].map(f => Math.round(R.catchRate("poke", "u", f) * 100)), [60, 70, 80], "놓칠 때마다 +10");
  eq(Math.round(R.catchRate("luxury", "c", 5) * 100), 100, "100%를 넘지 않음");
  const rnd = Y.rng(5), N = 60000;
  [["poke", "l", 0, 0.4], ["great", "r", 1, 0.85], ["ultra", "u", 2, 0.9]].forEach(([b, k, f, want]) => {
    let okN = 0;
    for (let i = 0; i < N; i++) if (R.throwBall(b, rnd, k, f).ok) okN++;
    ok(Math.abs(okN / N - want) < 0.01, b + " " + k + " 놓친 " + f + ": " + (okN / N * 100).toFixed(1) + "%");
  });
});

t("63. 희귀도로 기술까지 필요한 칸 (need) — 일반 15 · 레어 10 · 유니크 5 · 전설 처음부터, 마지막 모습이 아니어도", () => {
  const s = Y.newGame({ pieces: 4, seed: 9, skills: true, teams: [
    { name: "A", picks: [4, 1, 7, 150], paths: [[4, 5, 6], [1, 2, 3], [7, 8, 9], [150]], pools: [["nitro"], ["growth"], ["surf"], ["future"]], need: [15, 10, 5, 0] },
    { name: "B", picks: [24, 109, 52, 202], pools: [["toxic"], ["toxic"], ["toxic"], ["toxic"]], need: [15, 15, 15, 15] },
  ] }, D.evoFrom);
  eq(s.pieces.slice(0, 4).map(p => p.skill), [null, null, null, "future"], "전설은 판을 시작할 때 배움");
  const walkTo = (st, i, n) => { Object.assign(st.pieces[i], { state: "board", atGoal: false, walk: n - 1 }, Y.settle("OUT", 9)); return Y.applyMove(choose(st, [1]), "n9/1").state; };
  let a = walkTo(clone(s), 2, 5); eq([Y.formOf(a, 2), a.pieces[2].skill], [8, "surf"], "유니크 5칸: 두 번째 모습이어도 배움");
  a = walkTo(clone(s), 1, 9); eq(a.pieces[1].skill, null, "레어 9칸: 아직");
  a = walkTo(clone(s), 1, 10); eq(a.pieces[1].skill, "growth", "레어 10칸");
  a = walkTo(clone(s), 0, 10); eq([Y.formOf(a, 0), a.pieces[0].skill], [6, null], "일반 10칸: 마지막 모습이어도 아직");
  a = walkTo(clone(s), 0, 15); eq(a.pieces[0].skill, "nitro", "일반 15칸");
  eq([0, 1, 2, 3].map(i => Y.skillNeed(s, i)), [15, 10, 5, 0]);
  const sw = Y.applySwap(clone(s), 0, { id: 133, path: [133, 134], base: 0, pool: ["surf"], need: 10 }).state;
  eq(Y.skillNeed(sw, 0), 10, "바꿔 들어온 포켓몬은 그 포켓몬의 need");
  ok(Y.validate(s));
});

t("64. 🎁 못 쓴 기술을 골인하면 고른 팀원에게 — 기술 두 개, 제 기술을 다 썼으면 받은 기술만", () => {
  const g3 = () => sk({ n: 3, p0: [["nitro"], ["surf"], ["ddance"]] });
  let s = g3(); put(s, 0, 18); put(s, 1, 3); put(s, 2, 4);
  let r = Y.applyMove(choose(s, [3]), "n18/3");          // 니트로차지를 안 쓰고 골인
  ok(evTypes(r).includes("giftask"), "줄 세우기 이벤트");
  eq(r.state.gifts, [{ team: 0, from: 0, key: "nitro" }]);
  eq(Y.giftTargets(r.state, 0), [1, 2], "골인하지 않은 팀원");
  const g = Y.applyGift(r.state, 2);
  eq([g.state.pieces[2].gift, g.state.gifts], [{ key: "nitro", used: false }, []]);
  ok(g.events.some(e => e.type === "gift" && e.to === 2));
  // 기술 두 개: 용의춤(제 것) + 니트로차지(받은 것) 둘 다 쓸 수 있다
  let s2 = atThrow(g.state, 5, 0);
  eq(Y.legalSkills(s2).filter(x => x.piece === 2).map(x => x.slot + ":" + x.key), ["own:ddance", "gift:nitro"]);
  const a = Y.applySkill(s2, 2, null, "gift").state;
  eq([a.pieces[2].gift.used, a.pieces[2].used, Y.posOf(a.pieces[2])], [true, false, 6], "받은 기술만 씀");
  eq(Y.legalSkills(atThrow(a, 7, 0)).filter(x => x.piece === 2).map(x => x.slot), ["own"], "다음 차례엔 제 기술");
  // 제 기술을 이미 썼으면 받은 기술만
  s = g3(); put(s, 0, 18); put(s, 1, 3); s.pieces[1].used = true;
  r = Y.applyMove(choose(s, [3]), "n18/3");
  const b = Y.applyGift(r.state, 1).state;
  eq(Y.legalSkills(atThrow(b, 5, 0)).filter(x => x.piece === 1).map(x => x.slot + ":" + x.key), ["gift:nitro"]);
  // 받은 기술은 칸 수와 상관없이 (아직 제 기술을 못 배운 말도)
  s = sk({ n: 2, p0: [["nitro"], ["surf"]], e0: [true, false] }); put(s, 0, 18); put(s, 1, 3);
  r = Y.applyMove(choose(s, [3]), "n18/3");
  const c = Y.applyGift(r.state, 1).state;
  eq([c.pieces[1].skill, Y.legalSkills(atThrow(c, 5, 0)).map(x => x.slot + ":" + x.key)], [null, ["gift:nitro"]]);
});
t("65. 🎁 받은 기술 — 저절로 기술도 나감 · 이미 받은 기술을 든 팀원은 못 받음 · 이기면 안 넘김 · 로켓단은 바로 · 저장 검사", () => {
  // 받은 철벽이 저절로
  let s = sk({ n: 2, p1: [["iron"], ["nitro"]], e1: [false, true] });
  put(s, 3, 7); s.pieces[3].gift = { key: "iron", used: false }; s.pieces[3].used = true; put(s, 0, 4);
  let r = Y.applyMove(choose(s, [3]), "n4/3");
  eq([r.state.pieces[3].state, r.state.pieces[3].gift.used], ["board", true], "받은 철벽이 튕겨 냄");
  // 받은 기술을 이미 든 팀원은 후보에서 빠지고, 받을 팀원이 없으면 버림
  s = sk({ n: 3, p0: [["nitro"], ["surf"], ["ddance"]] }); put(s, 0, 18); put(s, 1, 3); s.pieces[2].state = "done";
  s.pieces[1].gift = { key: "splash", used: false };
  r = Y.applyMove(choose(s, [3]), "n18/3");
  ok(!evTypes(r).includes("giftask") && !(r.state.gifts || []).length, "받을 팀원이 없음");
  // 마지막 말이 골인해서 이기면 넘기지 않음
  s = sk({ n: 2 }); put(s, 0, 18); s.pieces[1].state = "done";
  r = Y.applyMove(choose(s, [3]), "n18/3");
  eq([r.state.phase, (r.state.gifts || []).length], ["over", 0]);
  // 두 기술(제 것 + 받은 것)을 못 쓰고 골인 → 두 개가 줄에
  s = sk({ n: 3, p0: [["nitro"], ["surf"], ["ddance"]] }); put(s, 0, 18); s.pieces[0].gift = { key: "splash", used: false }; put(s, 1, 3); put(s, 2, 5);
  r = Y.applyMove(choose(s, [3]), "n18/3");
  eq(r.state.gifts.map(x => x.key), ["nitro", "splash"]);
  let g = Y.applyGift(r.state, 1);
  g = Y.applyGift(g.state, 2);
  eq([g.state.pieces[1].gift.key, g.state.pieces[2].gift.key], ["nitro", "splash"]);
  let threw = false; try { Y.applyGift(g.state, 1); } catch (e) { threw = true; } ok(threw, "줄이 비었으면 오류");
  // 로켓단(cpu)은 알아서 바로
  s = Y.newGame({ pieces: 2, seed: 3, skills: true, teams: [
    { name: "A", picks: [6, 25], pools: [["nitro"], ["nitro"]] },
    { name: "R", cpu: true, picks: [24, 109], pools: [["toxic"], ["quake"]], now: [true, true] }] }, D.evoFrom);
  put(s, 2, 18); put(s, 3, 5);
  r = Y.applyMove(choose(s, [3], 1), "n18/3");
  ok(evTypes(r).includes("gift") && !(r.state.gifts || []).length && r.state.pieces[3].gift.key === "toxic", "로켓단은 줄 없이 바로");
  ok(Y.validate(r.state) && Y.validate(g.state));
  const bad = clone(g.state); bad.pieces[1].gift = { key: "없는기술", used: false }; ok(!Y.validate(bad), "이상한 받은 기술");
});

t("66. 💀 어려움 상자 — 볼 4개, 몬스터 25 · 슈퍼 30 · 하이퍼 25 · 럭셔리 10 · 마스터 10 (±0.5%p) · 기술을 아끼지 않음", () => {
  const R = Y.Rewards, rnd = Y.rng(66), N = 100000, cnt = {};
  eq(R.BOX_SIZE_HARD, 4);
  R.rollBox(N, rnd, R.BOX_ODDS_HARD).forEach(b => { cnt[b] = (cnt[b] || 0) + 1; });
  Object.keys(R.BOX_ODDS_HARD).forEach(b => ok(Math.abs(cnt[b] / N - R.BOX_ODDS_HARD[b] / 100) < 0.005, b + " " + (cnt[b] / N * 100).toFixed(2) + "%"));
  const c2 = {}; R.rollBox(N, rnd).forEach(b => { c2[b] = (c2[b] || 0) + 1; });
  ok(Math.abs(c2.poke / N - 0.5) < 0.005, "보통 상자는 그대로 50%");
  // 쓸모가 조금 있는 기술: 보통은 안 쓰고 어려움은 쓴다
  const s = sk({ p0: [["nitro"], ["nitro"]] }); put(s, 0, 3); put(s, 1, 12);
  let rs = 3; const rr = () => { const r = Y.rand(rs); rs = r[1]; return r[0]; };
  const best = Y.cpuSkill(s, "hard", rr);
  const v = best ? best.v : 0;
  if (v >= 8 && v < 15) ok(!Y.cpuSkill(s, "normal", () => 0.9), "보통은 아낌");
  let used = 0; for (let k = 0; k < 200; k++) if (Y.cpuSkill(s, "hard", rr)) used++;
  ok(used === 200 || v < 8, "어려움은 아끼지 않음 " + used);
});

t("67. 진화형을 골랐으면 그 모습부터 (bases) — 리자드로 출발, 5칸에 리자몽, 잡혀도 리자몽", () => {
  let s = Y.newGame({ pieces: 2, seed: 4, teams: [
    { name: "A", picks: [5, 1], paths: [[4, 5, 6], [1, 2, 3]], bases: [1, 0] },
    { name: "B", picks: [7, 152], paths: [[7, 8, 9], [152, 153, 154]] }] }, D.evoFrom);
  eq([Y.formOf(s, 0), Y.formOf(s, 1), s.pieces[0].base], [5, 1, 1]);
  put(s, 0, 4); s.pieces[0].walk = 4;
  s = move(choose(s, [1]), "n4/1");
  eq(Y.formOf(s, 0), 6, "5칸이면 리자몽");
  put(s, 2, 3);
  s = move(choose(s, [2], 1), "n3/2");
  eq([s.pieces[0].state, Y.formOf(s, 0)], ["wait", 6], "잡혀도 리자몽 그대로");
  ok(Y.validate(s));
});

// ---------- v8: ✨ 기술 다시 세팅 (36개) · 🎲 발동 확률 ----------
t("68. 와일드볼트 — 바로 3칸(잡기도) · 이번 차례는 그대로, 우리 다음 차례에 못 움직임", () => {
  const s = sk({ p0: [["wildcharge"], ["nitro"]] }); put(s, 0, 3); put(s, 2, 6);
  const r = Y.applySkill(s, 0, null);
  eq([node(r.state, 0), r.state.pieces[2].state, r.state.pieces[0].walk, r.state.throwsLeft], [6, "wait", 3, 2]);
  ok(Y.legalMoves(at(r.state, 1, 0)).some(m => m.unit === "n6"), "이번 차례엔 움직임");
  ok(!Y.legalMoves(at(r.state, 3, 0)).some(m => m.unit === "n6"), "다음 차례엔 쉼");
  ok(Y.legalMoves(at(r.state, 5, 0)).some(m => m.unit === "n6"), "그다음엔 움직임");
});
t("69. 아이스차징 — 상대 말 하나 다음 차례 못 움직임 · 그다음 그 팀 윷은 빽도·도·개만", () => {
  const s = sk({ p0: [["icecharge"], ["nitro"]] }); put(s, 0, 3); put(s, 2, 10); put(s, 3, 12);
  const s1 = Y.applySkill(s, 0, 10).state;
  ok(!Y.legalMoves(at(s1, 2, 1)).some(m => m.unit === "n10"), "얼은 말");
  ok(Y.legalMoves(at(s1, 2, 1)).some(m => m.unit === "n12"), "다른 말은 움직임");
  eq(s1.teams[1].fx.chill, 4);
  [3, 4, 5].forEach(r => { const e = Y.applyThrow(atThrow(s1, 4, 1), r).events[0]; eq([e.result, e.chilled, e.again], [2, r, false], "결과 " + r); });
  eq([-1, 1, 2].map(r => Y.applyThrow(atThrow(s1, 4, 1), r).events[0].result), [-1, 1, 2]);
  eq(Y.applyThrow(atThrow(s1, 6, 1), 4).events[0].result, 4, "그다음엔 그대로");
  ok(Y.legalMoves(at(s1, 4, 1)).some(m => m.unit === "n10"), "얼음은 한 번만");
});
t("70. 벌크업 +1칸 두 번 · 독찌르기 −1칸 두 번 (도는 못 씀) · 빽도는 그대로", () => {
  let s = sk({ p0: [["bulkup"], ["poisonjab"]] }); put(s, 0, 3); put(s, 1, 14); put(s, 2, 10);
  const s1 = Y.applySkill(s, 0, null).state;
  eq(s1.pieces[0].fx.bulk, 2);
  let r = Y.applyMove(choose(clone(s1), [2]), "n3/2"); eq(node(r.state, 0), 6);
  r = Y.applyMove(choose(r.state, [1]), "n6/1"); eq(node(r.state, 0), 8);
  r = Y.applyMove(choose(r.state, [1]), "n8/1"); eq([node(r.state, 0), r.state.pieces[0].fx.bulk], [9, undefined], "두 번 뒤엔 보통");
  r = Y.applyMove(choose(clone(s1), [-1]), "n3/-1"); eq([node(r.state, 0), r.state.pieces[0].fx.bulk], [2, 2], "빽도는 그대로");
  const s2 = Y.applySkill(atThrow(s1, 3, 0), 1, 10).state;
  eq(s2.pieces[2].fx.weak, 2);
  const b = at(s2, 4, 1, [1, 3]);
  ok(!Y.legalMoves(b).some(m => m.id === "n10/1"), "도는 제자리라 못 씀");
  r = Y.applyMove(b, "n10/3"); eq(node(r.state, 2), 26, "걸이 개만큼");
});
t("71. 구멍파기 — 상대 차례 한 번 안 잡히고 기술도 안 맞음 + 다음 이동 +1칸", () => {
  const s = sk({ p0: [["dig"], ["nitro"]], p1: [["surf"], ["surf"]], e1: [true, true] }); put(s, 0, 8); put(s, 2, 6); put(s, 3, 3);
  const s1 = Y.applySkill(s, 0, null).state;
  ok(!Y.legalMoves(at(s1, 2, 1)).some(m => m.to && m.to.node === 8), "숨은 칸에 멈춤");
  ok(!Y.legalSkills(atThrow(s1, 2, 1)).some(x => x.targets.indexOf(8) >= 0), "숨은 말을 밈");
  ok(Y.legalMoves(at(s1, 4, 1)).some(m => m.to && m.to.node === 8), "한 번 뒤엔 나옴");
  const r = Y.applyMove(at(s1, 1, 0, [2]), "n8/2");
  eq([node(r.state, 0), r.state.pieces[0].fx.digup], [11, undefined], "다음 이동 +1칸 한 번");
});
t("72. 스톤에지 — 가장 앞선 상대 3칸 뒤로 (우리 말 앞에서 멈춤) · 역린 — 앞 1~2칸 상대 모두 + 한 번 더, 우리 차례 두 번 쉼", () => {
  let s = sk({ p0: [["stoneedge"], ["outrage"]] }); put(s, 0, 2); put(s, 2, 8); put(s, 3, 14);
  let r = Y.applySkill(s, 0, null);
  eq([node(r.state, 3), node(r.state, 2)], [11, 8]);
  s = sk({ p0: [["stoneedge"], ["outrage"]] }); put(s, 0, 2); put(s, 1, 12); put(s, 2, 8); put(s, 3, 14);
  eq(node(Y.applySkill(s, 0, null).state, 3), 13, "우리 말 앞에서 멈춤");
  s = sk({ p0: [["stoneedge"], ["outrage"]] }); put(s, 1, 3); put(s, 2, 4); put(s, 3, 5);
  r = Y.applySkill(s, 1, null);
  eq([r.state.pieces[2].state, r.state.pieces[3].state, node(r.state, 1), r.state.throwsLeft], ["wait", "wait", 3, 2]);
  eq(r.events.filter(e => e.type === "capture").length, 2);
  ok(Y.legalMoves(at(r.state, 1, 0)).some(m => m.unit === "n3"), "이번 차례엔 움직임");
  ok(!Y.legalMoves(at(r.state, 3, 0)).some(m => m.unit === "n3") && !Y.legalMoves(at(r.state, 5, 0)).some(m => m.unit === "n3"), "우리 차례 두 번 쉼");
  ok(Y.legalMoves(at(r.state, 7, 0)).some(m => m.unit === "n3"));
  s = sk({ p0: [["stoneedge"], ["outrage"]] }); put(s, 1, 3); put(s, 2, 6);
  ok(!Y.legalSkills(s).some(x => x.piece === 1), "3칸 앞은 안 닿음");
  s = sk({ p0: [["stoneedge"], ["outrage"]], p1: [["iron"], ["iron"]], e1: [true, true] }); put(s, 1, 3); put(s, 2, 4); put(s, 3, 5);
  r = Y.applySkill(s, 1, null);
  eq([r.state.pieces[2].state, r.state.pieces[3].state], ["board", "board"], "철벽이면 막힘");
});
t("73. 독압정 — 상대가 멈추면 다음 차례에 못 움직임 (이번 차례는 괜찮음), 지나가면 그대로", () => {
  const s = sk({ p0: [["spike"], ["nitro"]] }); put(s, 0, 3);
  const s1 = Y.applySkill(s, 0, 9).state;
  eq(s1.traps, [{ node: 9, kind: "spike", team: 0 }]);
  put(s1, 2, 7);
  const b = at(s1, 2, 1, [2, 3]);
  ok(Y.legalMoves(b).find(m => m.id === "n7/2").spike, "미리보기에 압정 표시");
  let r = Y.applyMove(b, "n7/2");
  eq([node(r.state, 2), r.state.traps], [9, []]);
  ok(Y.legalMoves(r.state).some(m => m.unit === "n9"), "이번 차례 남은 윷은 씀");
  ok(!Y.legalMoves(at(r.state, 4, 1)).some(m => m.unit === "n9"), "다음 차례엔 못 움직임");
  ok(Y.legalMoves(at(r.state, 6, 1)).some(m => m.unit === "n9"));
  r = Y.applyMove(b, "n7/3");
  eq([node(r.state, 2), r.state.traps.length], [10, 1], "지나가면 괜찮음");
});
t("74. 자력선 — 뒤에 있는 우리 말을 끌어와 업음 (칸 수엔 안 셈) · 천사의키스 — 다음 이동 한 번은 뒤로", () => {
  let s = sk({ n: 3, p0: [["magnet"], ["nitro"], ["nitro"]] }); put(s, 0, 9); put(s, 1, 3); put(s, 2, 12);
  eq(Y.legalSkills(s).find(x => x.piece === 0).targets, [3]);
  let r = Y.applySkill(s, 0, 3);
  eq([node(r.state, 1), r.state.pieces[1].walk, Y.unitsOf(r.state, 0).length], [9, 0, 2]);
  ok(Y.validate(r.state));
  s = sk({ p0: [["kiss"], ["nitro"]] }); put(s, 0, 3); put(s, 1, 7); put(s, 2, 10);
  const s1 = Y.applySkill(s, 0, 10).state;
  eq(s1.pieces[2].fx.confuse, 1);
  const b = at(s1, 2, 1, [3]);
  const m = Y.legalMoves(b).find(x => x.unit === "n10");
  ok(m && m.confused);
  r = Y.applyMove(b, m.id);
  eq([node(r.state, 2), r.state.pieces[2].walk, r.state.pieces[2].fx.confuse], [8, 0, undefined], "뒤로 가다 상대 말 앞에서 멈춤");
  r = Y.applyMove(at(s1, 2, 1, [-1]), "n10/-1");
  eq([node(r.state, 2), r.state.pieces[2].fx.confuse], [9, 1], "빽도는 그대로");
  s = sk({ p0: [["kiss"], ["nitro"]] }); put(s, 0, 3); put(s, 2, 1);
  const s2 = Y.applySkill(s, 0, 1).state;
  r = Y.applyMove(at(s2, 2, 1, [2]), "n1/2");
  eq([node(r.state, 2), r.state.pieces[2].fx.confuse], [1, undefined], "못 물러나면 제자리");
});
t("75. 카운터가 새 기술도 되돌림 — 방전(쓴 팀) · 아이스차징(쓴 말) · 역린(쓴 말이 집으로) · 사이드체인지(막기만)", () => {
  const c = p0 => sk({ p0, p1: [["counter"], ["counter"]], e1: [true, true] });
  let s = c([["discharge"], ["nitro"]]); put(s, 0, 3); put(s, 1, 7); put(s, 2, 10);
  let r = Y.applySkill(s, 0, null);
  ok(evTypes(r).includes("reflect"));
  ok(!Y.legalMoves(at(r.state, 3, 0)).some(m => m.unit === "n3" || m.unit === "n7"), "쓴 팀 말이 마비");
  ok(Y.legalMoves(at(r.state, 2, 1)).some(m => m.unit === "n10"));
  s = c([["icecharge"], ["nitro"]]); put(s, 0, 3); put(s, 2, 10);
  r = Y.applySkill(s, 0, 10);
  ok(!Y.legalMoves(at(r.state, 3, 0)).some(m => m.unit === "n3")); eq(r.state.teams[0].fx.chill, 5);
  s = c([["outrage"], ["nitro"]]); put(s, 0, 3); put(s, 2, 4);
  r = Y.applySkill(s, 0, null);
  eq([r.state.pieces[0].state, r.state.pieces[2].state], ["wait", "board"]);
  s = c([["allyswitch"], ["nitro"]]); put(s, 0, 3); put(s, 2, 14);
  r = Y.applySkill(s, 0, 14);
  eq([node(r.state, 0), node(r.state, 2)], [3, 14]);
});
t("76. 🎲 발동 확률 — 희귀도 60·70·80·90 · 상대 말 하나에 거는 기술은 상성 ±10 · 실패하면 기술이 사라짐", () => {
  const mk = (rar, types) => { const s = sk({ p0: [["flame"], ["nitro"]] }); s.teams[0].rar = [rar, rar]; if (types) s.teams[1].types = [types, types]; put(s, 0, 3); put(s, 1, 12); put(s, 2, 5); return s; };
  eq(["c", "r", "u", "l"].map(r => Y.skillChance(mk(r), 0, "flame", 5).chance), [0.6, 0.7, 0.8, 0.9]);
  eq(Y.skillChance(mk("c", [["물"], ["물"], ["물"]]), 0, "flame", 5), { chance: 0.5, base: 0.6, match: -1 }, "불꽃 → 물 별로");
  eq(Y.skillChance(mk("l", [["풀", "독"]]), 0, "flame", 5).chance, 1, "전설 + 상성 = 100%");
  eq(Y.skillChance(mk("c", [["풀", "물"]]), 0, "flame", 5).match, 0, "2 × 0.5 = 보통");
  eq(Y.skillChance(mk("c", [["물"]]), 1, "nitro", null).match, 0, "우리 쪽 기술은 상성 없음");
  eq([Y.typeEff("전기", "땅"), Y.typeEff("물", "불꽃"), Y.typeEff("풀", "불꽃"), Y.typeEff("노말", "노말")], [0, 2, 0.5, 1]);
  let okN = 0;
  const N = 3000;
  for (let k = 0; k < N; k++) {
    const s = mk("r");
    s.srng = ((k + 1) * 2654435761 >>> 0) || 1;
    const r = Y.applySkill(s, 0, 5), e = r.events[0];
    eq([e.type, e.chance], ["skill", 0.7]);
    if (e.ok) { okN++; eq(r.state.pieces[2].state, "wait"); continue; }
    eq([r.state.pieces[0].used, r.state.pieces[2].state, r.state.skillTurn], [true, "board", 1]);
    ok(evTypes(r).includes("skillfail"));
    ok(!Y.legalSkills(atThrow(r.state, 3, 0)).some(x => x.piece === 0), "다음 차례에도 못 씀 (사라짐)");
  }
  ok(Math.abs(okN / N - 0.7) < 0.03, "성공 비율 " + okN / N);
});
t("77. 🎲 저절로 기술도 희귀도 확률 — 철벽이 실패하면 잡히고 철벽도 사라짐", () => {
  let okN = 0;
  const N = 2000;
  for (let k = 0; k < N; k++) {
    const s = sk({ p1: [["iron"], ["iron"]], e1: [true, true] }); s.teams[1].rar = ["c", "c"];
    put(s, 0, 4); put(s, 2, 7);
    s.srng = ((k + 1) * 2246822519 >>> 0) || 1;
    const r = Y.applyMove(choose(s, [3]), "n4/3");
    if (evTypes(r).includes("block")) { okN++; continue; }
    ok(evTypes(r).includes("reactfail"));
    eq([r.state.pieces[2].state, r.state.pieces[2].used], ["wait", true]);
  }
  ok(Math.abs(okN / N - 0.6) < 0.035, "철벽 성공 비율 " + okN / N);
});
t("78. 옛 판 이어 하기 (v8) — 흑안개 → 아이스차징 · 전기자석파 → 방전 · 기술까지 칸은 모두 10칸", () => {
  const s = sk({ p0: [["haze"], ["twave", "sleep"]] });
  delete s.k8;
  s.teams[0].pools = [["haze"], ["twave", "sleep"]]; s.teams[0].need = [15, 5];
  s.pieces[0].skill = "haze"; s.pieces[1].gift = { key: "twave", used: false };
  ok(!Y.validate(s), "옛 기술 그대로는 검사 실패");
  const u = Y.upgrade(s);
  ok(Y.validate(u));
  eq([u.teams[0].pools, u.teams[0].need, u.pieces[0].skill, u.pieces[1].gift.key], [[["icecharge"], ["discharge", "sleep"]], [10, 10], "icecharge", "discharge"]);
  eq(Y.upgrade(u), u, "두 번 해도 같음");
  eq(Object.keys(Y.TYPE_SKILLS).map(k => Y.TYPE_SKILLS[k].length), Array(18).fill(3), "타입마다 3개 (2026-10-10)");
  eq(Object.keys(Y.SKILLS).length, 54);
  const all = [].concat(...Object.keys(Y.TYPE_SKILLS).map(k => Y.TYPE_SKILLS[k]));
  eq([all.length, new Set(all).size], [54, 54], "기술마다 한 타입");
  ok(all.every(k => Y.SKILLS[k] && Y.TYPE_SKILLS[Y.SKILLS[k].type].indexOf(k) >= 0), "기술의 type 과 TYPE_SKILLS 가 맞음");
});

t("79. 10칸 전에 윷·모로 골인해도 들어오면서 기술을 배우고 → 팀원에게 넘김 (순풍 골인도)", () => {
  let s = Y.newGame({ pieces: 2, seed: 3, skills: true, teams: [
    { name: "A", picks: [6, 25], pools: [["nitro"], ["surf"]], need: [10, 10] },
    { name: "B", picks: [9, 26], pools: [["iron"], ["iron"]], need: [10, 10] }] }, D.evoFrom);
  Object.assign(s.pieces[0], { state: "board", atGoal: false, walk: 6 }, Y.settle("A", 9)); // 방(22)을 지난 대각선 → 참먹이까지 2칸
  s.pieces[0].route = "C"; s.pieces[0].step = 9;
  put(s, 1, 3);
  let r = Y.applyMove(choose(s, [5]), "n27/5");
  eq(evTypes(r).filter(x => x === "learn" || x === "giftask"), ["learn", "giftask"]);
  eq([r.state.pieces[0].state, r.state.pieces[0].skill, r.state.gifts[0].key], ["done", "nitro", "nitro"]);
  eq(Y.applyGift(r.state, 1).state.pieces[1].gift.key, "nitro");
  s = sk({ p0: [["tailwind"], ["nitro"]] });
  s.teams[0].now = [true, false]; s.pieces[1].skill = null; s.teams[0].need = [10, 10];
  put(s, 0, 3); Object.assign(s.pieces[1], { state: "board", atGoal: true, route: "OUT", step: 0, walk: 3 });
  r = Y.applySkill(s, 0, null);
  eq([r.state.pieces[1].state, r.state.pieces[1].skill, (r.state.gifts || []).length], ["done", "nitro", 1], "순풍으로 골인해도");
});
// ---------- 2026-10-10: ✨ 새 기술 18개 (타입마다 3개, 54개) ----------
t("80. 흉내내기 — 상대가 바로 전에 쓴 기술을 따라 씀 (쓴 게 없으면 못 씀, 손가락흔들기로 나온 기술도 그 기술로)", () => {
  const s = sk({ p0: [["mimic"], ["nitro"]], p1: [["surf"], ["surf"]], e1: [true, true] });
  put(s, 0, 9); put(s, 1, 4); put(s, 2, 6); put(s, 3, 14);
  ok(!Y.legalSkills(s).some(x => x.piece === 0), "상대가 쓴 게 없으면 못 씀");
  const b = Y.applySkill(atThrow(s, 2, 1), 2, 9).state;
  eq([node(b, 0), b.teams[1].fx.lastSkill], [7, "surf"]);
  const a = atThrow(b, 3, 0);
  eq(Y.mimicKey(a, 0), "surf");
  const r = Y.applySkill(a, 0, null);
  ok(r.events.some(e => e.type === "mimic" && e.key === "surf"), "mimic 사건");
  ok(r.events.some(e => e.type === "push" && e.skill === "surf" && e.by === 0), "파도타기가 나감");
  eq(r.state.teams[0].fx.lastSkill, "surf", "따라 쓴 기술도 '쓴 기술'로");
  // 실패한 기술은 따라 할 수 없음
  const f = atThrow(s, 2, 1); f.teams[1].rar = ["c", "c"];
  for (let k = 1; k < 300; k++) { const c = clone(f); c.srng = k; const rr = Y.applySkill(c, 2, 9); if (evTypes(rr).includes("skillfail")) { eq(rr.state.teams[1].fx.lastSkill, undefined); break; } }
  // 손가락흔들기로 나온 기술이 기록됨
  const m = sk({ p0: [["metronome"], ["mimic"]], p1: [["mimic"], ["nitro"]], e1: [true, true] }); put(m, 0, 3); put(m, 2, 5);
  const rm = Y.applySkill(m, 0, null);
  const k = rm.events.find(e => e.type === "metronome").key;
  ok(k === "mimic" || rm.state.teams[0].fx.lastSkill === k, "손가락흔들기 → " + k);
});
t("81. 열풍 — 앞쪽 4칸 안의 상대 말 모두 2칸 뒤로 (가까운 말부터, 우리 말 앞에서 멈춤), 5칸째는 그대로", () => {
  const s = sk({ n: 3, p0: [["heatwave"], ["nitro"], ["nitro"]] });
  put(s, 0, 3); put(s, 3, 5); put(s, 4, 7); put(s, 5, 9);
  const r = Y.applySkill(s, 0, null);
  eq([node(r.state, 3), node(r.state, 4), node(r.state, 5)], [4, 5, 9]);
  eq(r.events.filter(e => e.type === "push" && e.skill === "heatwave").length, 2);
  const s2 = sk({ n: 3, p0: [["heatwave"], ["nitro"], ["nitro"]] }); put(s2, 0, 3); put(s2, 3, 4); put(s2, 5, 9);
  ok(!Y.legalSkills(s2).some(x => x.piece === 0), "바로 앞 말은 못 밀고 9는 멀어서 못 씀");
});
t("82. 물붓기 — 상대 말 하나의 기술(제 것·받은 것)을 씻어 없앰, 집에 있는 말도 · 기술 없는 말은 대상 아님", () => {
  const s = sk({ p0: [["soak"], ["nitro"]], p1: [["nitro"], ["iron"]], e1: [true, true] });
  put(s, 0, 3); put(s, 2, 10); s.pieces[2].gift = { key: "splash", used: false };
  eq(Y.legalSkills(s).find(x => x.piece === 0).targets, [2, 3]);
  let r = Y.applySkill(s, 0, 2);
  eq([r.state.pieces[2].used, r.state.pieces[2].gift.used], [true, true]);
  eq(r.events.find(e => e.type === "soak").keys, ["nitro", "splash"]);
  ok(!Y.legalSkills(atThrow(r.state, 2, 1)).some(x => x.piece === 2), "씻긴 말은 기술을 못 씀");
  r = Y.applySkill(s, 0, 3);
  eq(r.state.pieces[3].used, true, "집에 있는 철벽도 씻김");
  const s2 = sk({ p0: [["soak"], ["nitro"]], p1: [["nitro"], ["iron"]], e1: [false, false] }); put(s2, 0, 3); put(s2, 2, 10);
  ok(!Y.legalSkills(s2).some(x => x.piece === 0), "기술이 없는 상대뿐이면 못 씀");
});
t("83. 목화포자 — 상대의 다음 윷 한 단계 작게 (걸→개 · 개→도 · 윷→걸 · 모→윷, 도·빽도는 그대로), 한 번만", () => {
  const s = sk({ p0: [["cotton"], ["nitro"]] }); put(s, 0, 3);
  const s1 = Y.applySkill(s, 0, null).state;
  eq(s1.teams[1].fx.cotton, true);
  [[3, 2], [2, 1], [4, 3], [5, 4], [1, 1], [-1, -1]].forEach(([a, b]) => {
    const r = Y.applyThrow(atThrow(s1, 2, 1), a);
    eq([r.events[0].result, r.events[0].cottoned, r.state.teams[1].fx.cotton], [b, a === b ? null : a, false], a + " → " + b);
  });
  eq(Y.applyThrow(atThrow(s1, 2, 1), 5).events[0].again, true, "모 → 윷은 한 번 더");
  const r2 = Y.applyThrow(atThrow(s1, 2, 1), 3);
  eq(Y.applyThrow(atThrow(r2.state, 4, 1), 3).events[0].result, 3, "그다음엔 그대로");
  ok(!Y.legalSkills(atThrow(s1, 3, 0)).some(x => x.key === "cotton"), "이미 걸려 있으면 또 못 씀");
});
t("84. 전자포 — 이 말의 직선 줄(모서리면 두 변 + 대각선) 위 상대 말마다 반의 확률로 물리침, 줄 밖은 그대로", () => {
  eq(Y.lineNodes(8).sort((a, b) => a - b), [5, 6, 7, 9, 10]);
  eq(Y.lineNodes(22).sort((a, b) => a - b), [0, 5, 10, 15, 20, 21, 23, 24, 25, 26, 27, 28]);
  let hits = 0, tries = 0;
  for (let k = 1; k <= 300; k++) {
    const s = sk({ n: 3, p0: [["zap"], ["nitro"], ["nitro"]] });
    put(s, 0, 5); put(s, 3, 8); put(s, 4, 21); put(s, 5, 12);
    s.srng = (k * 2654435761 >>> 0) || 1;
    const r = Y.applySkill(s, 0, null);
    const z = r.events.find(e => e.type === "zap");
    eq(z.rolls.map(x => x.node).sort((a, b) => a - b), [8, 21]);
    z.rolls.forEach(x => { tries++; const j = x.node === 8 ? 3 : 4; eq(r.state.pieces[j].state, x.hit ? "wait" : "board"); if (x.hit) hits++; });
    eq(r.state.pieces[5].state, "board", "줄 밖");
    eq(r.state.throwsLeft, z.rolls.some(x => x.hit) ? 2 : 1, "한 번 더는 한 번만");
  }
  ok(Math.abs(hits / tries - 0.5) < 0.07, "반쯤 " + hits / tries);
});
t("85. 눈사태 — 모서리·방(5·10·15·22)의 상대 말 모두 집으로, 다른 칸은 그대로 · 없으면 못 씀", () => {
  const s = sk({ n: 3, p0: [["avalanche"], ["nitro"], ["nitro"]] });
  put(s, 0, 3); put(s, 3, 10); put(s, 4, 22, "A"); put(s, 5, 7);
  const r = Y.applySkill(s, 0, null);
  eq([r.state.pieces[3].state, r.state.pieces[4].state, r.state.pieces[5].state, r.state.throwsLeft], ["wait", "wait", "board", 2]);
  const s2 = sk({ n: 3, p0: [["avalanche"], ["nitro"], ["nitro"]] }); put(s2, 0, 3); put(s2, 3, 7);
  ok(!Y.legalSkills(s2).some(x => x.piece === 0));
});
t("86. 로킥 — 상대 말 하나를 1~5칸 중 무작위로 뒤로", () => {
  const seen = {};
  for (let k = 1; k <= 200; k++) {
    const s = sk({ p0: [["lowkick"], ["nitro"]] }); put(s, 0, 3); put(s, 2, 12);
    s.srng = (k * 2654435761 >>> 0) || 1;
    const r = Y.applySkill(s, 0, 12);
    const n = 12 - node(r.state, 2);
    ok(n >= 1 && n <= 5, "칸 " + n); seen[n] = 1;
  }
  eq(Object.keys(seen).map(Number).sort(), [1, 2, 3, 4, 5]);
});
t("87. 베놈쇼크 — 독(독찌르기·맹독·독압정)에 걸린 상대 말은 물리치고, 아니면 2칸 뒤로", () => {
  const v = () => { const s = sk({ p0: [["venoshock"], ["nitro"]] }); put(s, 0, 3); put(s, 2, 10); return s; };
  let r = Y.applySkill(v(), 0, 10);
  eq([node(r.state, 2), r.events.find(e => e.type === "venoshock").poisoned], [8, false]);
  let s = v(); s.pieces[2].fx = { weak: 2 };
  r = Y.applySkill(s, 0, 10); eq([r.state.pieces[2].state, r.state.throwsLeft], ["wait", 2], "독찌르기");
  s = v(); s.teams[1].fx.poison = true;
  eq(Y.applySkill(s, 0, 10).state.pieces[2].state, "wait", "맹독");
  s = v(); s.pieces[2].fx = { spike: 2, spikeFrom: 2 };
  eq(Y.applySkill(s, 0, 10).state.pieces[2].state, "wait", "독압정");
  s = v(); put(s, 1, 9);
  ok(!Y.legalSkills(s).some(x => x.piece === 0), "독도 없고 뒤가 막혔으면 못 씀");
  s.pieces[2].fx = { weak: 1 };
  eq(Y.legalSkills(s).find(x => x.piece === 0).targets, [10], "독이 있으면 뒤가 막혀도 됨");
});
t("88. 대지의힘 — 이 말의 직선 줄 위 우리 말을 모두 끌어와 업음 (칸 수엔 안 셈), 줄 밖은 그대로 · 참먹이 위에서는 못 씀", () => {
  const s = sk({ n: 4, p0: [["earthpower"], ["nitro"], ["nitro"], ["nitro"]] });
  put(s, 0, 5); put(s, 1, 8); put(s, 2, 12); put(s, 3, 21);
  const r = Y.applySkill(s, 0, null);
  eq([0, 1, 2, 3].map(i => node(r.state, i)), [5, 5, 12, 5]);
  eq([r.state.pieces[1].walk, Y.unitsOf(r.state, 0).length], [0, 2]);
  ok(Y.validate(r.state));
  const s2 = sk({ n: 2, p0: [["earthpower"], ["nitro"]] });
  Object.assign(s2.pieces[0], { state: "board", route: "OUT", step: 0, atGoal: true }); put(s2, 1, 3);
  ok(!Y.legalSkills(s2).some(x => x.piece === 0), "참먹이 위");
});
t("89. 애크러뱃 — 혼자면 3칸, 업고 있으면 1칸 (잡기도)", () => {
  let s = sk({ p0: [["acrobatics"], ["nitro"]] }); put(s, 0, 3); put(s, 2, 6);
  let r = Y.applySkill(s, 0, null);
  eq([node(r.state, 0), r.state.pieces[2].state, r.state.pieces[0].walk], [6, "wait", 3]);
  s = sk({ p0: [["acrobatics"], ["nitro"]] }); put(s, 0, 3); put(s, 1, 3);
  r = Y.applySkill(s, 0, null);
  eq([node(r.state, 0), node(r.state, 1)], [4, 4]);
});
t("90. 자기암시 — 던지기 전에만, 다음 윷을 두 번 던져 큰 쪽 (빽도가 가장 작음), 한 번만", () => {
  const s = sk({ p0: [["psychup"], ["nitro"]] }); put(s, 0, 3);
  ok(!Y.legalSkills(choose(clone(s), [2])).some(x => x.piece === 0), "고르는 중엔 못 씀");
  const s1 = Y.applySkill(s, 0, null).state;
  eq([s1.psych, s1.phase], [0, "throw"]);
  const rank = r => (r === -1 ? 0 : r);
  for (let k = 1; k <= 200; k++) {
    const c = clone(s1); c.rng = k;
    const e = Y.applyThrow(c).events[0];
    const t1 = Y.throwSticks(k, true), t2 = Y.throwSticks(t1.rng, true);
    eq(e.psych, [t1.result, t2.result]);
    eq(e.result, rank(t2.result) > rank(t1.result) ? t2.result : t1.result);
  }
  const r = Y.applyThrow(clone(s1), 1);
  ok(r.events[0].result >= 1 && r.events[0].psych[0] === 1, "정한 결과(시험)도 두 번 중 큰 쪽");
  eq(r.state.psych, null, "한 번만");
});
t("91. 실뿜기 — 상대 말 모두 다음 한 번 1칸씩 덜 (도는 못 씀), 한 번 뒤엔 보통", () => {
  const s = sk({ p0: [["stringshot"], ["nitro"]] }); put(s, 0, 3); put(s, 2, 10); put(s, 3, 13);
  const s1 = Y.applySkill(s, 0, null).state;
  eq([s1.pieces[2].fx.string, s1.pieces[3].fx.string], [1, 1]);
  const b = at(s1, 2, 1, [1, 2]);
  ok(!Y.legalMoves(b).some(m => m.id === "n10/1"), "도는 못 씀");
  const r = Y.applyMove(b, "n10/2");
  eq([node(r.state, 2), r.state.pieces[2].fx.string, r.state.pieces[3].fx.string], [25, undefined, 1], "뒷모에서 개가 1칸 (대각선)");
  ok(!Y.legalSkills(atThrow(s1, 3, 0)).some(x => x.key === "stringshot"), "모두 걸려 있으면 또 못 씀");
});
t("92. 록커트 — 다음 두 번 2칸씩 더, 그다음엔 보통", () => {
  const s = sk({ p0: [["rockpolish"], ["nitro"]] }); put(s, 0, 3);
  const s1 = Y.applySkill(s, 0, null).state;
  eq(s1.pieces[0].fx.polish, 2);
  let r = Y.applyMove(choose(clone(s1), [2]), "n3/2"); eq(node(r.state, 0), 7);
  r = Y.applyMove(choose(r.state, [1]), "n7/1"); eq(node(r.state, 0), 10);
  r = Y.applyMove(choose(r.state, [1]), "n10/1"); eq([node(r.state, 0), r.state.pieces[0].fx.polish], [25, undefined]);
});
t("93. 야습 — 바로 뒤 2칸 안의 상대 말을 모두 물리침 (한 번 더는 한 번), 3칸 뒤·앞은 그대로", () => {
  const s = sk({ n: 3, p0: [["shadowsneak"], ["nitro"], ["nitro"]] });
  put(s, 0, 8); put(s, 3, 7); put(s, 4, 6); put(s, 5, 9);
  const r = Y.applySkill(s, 0, null);
  eq([r.state.pieces[3].state, r.state.pieces[4].state, r.state.pieces[5].state, node(r.state, 0), r.state.throwsLeft], ["wait", "wait", "board", 8, 2]);
  const s2 = sk({ n: 3, p0: [["shadowsneak"], ["nitro"], ["nitro"]] }); put(s2, 0, 8); put(s2, 3, 5); put(s2, 5, 9);
  ok(!Y.legalSkills(s2).some(x => x.piece === 0));
  const s3 = sk({ n: 3, p0: [["shadowsneak"], ["nitro"], ["nitro"]] }); put(s3, 0, 20); put(s3, 3, 5);
  eq(Y.applySkill(s3, 0, null).state.pieces[3].state, "wait", "대각선에서 뒤 = 모");
});
t("94. 용성군 — 판 위 아무 상대 말 하나를 물리침, 쓴 말은 다음 두 번 1칸씩 덜 · 철벽이면 막힘", () => {
  let s = sk({ p0: [["dracometeor"], ["nitro"]] }); put(s, 0, 3); put(s, 2, 14); put(s, 3, 27);
  eq(Y.legalSkills(s).find(x => x.piece === 0).targets.sort((a, b) => a - b), [14, 27]);
  let r = Y.applySkill(s, 0, 14);
  eq([r.state.pieces[2].state, r.state.throwsLeft, r.state.pieces[0].fx.slow], ["wait", 2, 2]);
  let m = Y.applyMove(choose(clone(r.state), [2]), "n3/2"); eq(node(m.state, 0), 4, "1칸 덜");
  m = Y.applyMove(choose(m.state, [3]), "n4/3"); eq(node(m.state, 0), 6);
  m = Y.applyMove(choose(m.state, [2]), "n6/2"); eq([node(m.state, 0), m.state.pieces[0].fx.slow], [8, undefined]);
  s = sk({ p0: [["dracometeor"], ["nitro"]], p1: [["iron"], ["iron"]], e1: [true, true] }); put(s, 0, 3); put(s, 2, 14);
  r = Y.applySkill(s, 0, 14);
  eq([r.state.pieces[2].state, (r.state.pieces[0].fx || {}).slow], ["board", undefined]); ok(evTypes(r).includes("block"));
});
t("95. 따라가때리기 — 앞쪽 가장 가까운 상대 말 바로 뒤 칸까지 (칸 수에 셈, 잡지 않음) · 바로 앞이면·없으면 못 씀", () => {
  let s = sk({ p0: [["pursuit"], ["nitro"]] }); put(s, 0, 3); put(s, 2, 9); put(s, 3, 12);
  let r = Y.applySkill(s, 0, null);
  eq([node(r.state, 0), r.state.pieces[0].walk, r.state.pieces[2].state], [8, 5, "board"]);
  s = sk({ p0: [["pursuit"], ["nitro"]] }); put(s, 0, 3); put(s, 2, 4); put(s, 3, 12);
  ok(!Y.legalSkills(s).some(x => x.piece === 0), "바로 앞");
  s = sk({ p0: [["pursuit"], ["nitro"]] }); put(s, 0, 3);
  ok(!Y.legalSkills(s).some(x => x.piece === 0), "앞에 없음");
  s = sk({ p0: [["pursuit"], ["nitro"]] }); put(s, 0, 20); put(s, 2, 23);
  eq(node(Y.applySkill(s, 0, null).state, 0), 22, "대각선 길을 따라");
});
t("96. 기어업 — 판 위 우리 말 모두 다음 한 번 1칸씩 더", () => {
  const s = sk({ n: 3, p0: [["gearup"], ["nitro"], ["nitro"]] }); put(s, 0, 3); put(s, 1, 7);
  const s1 = Y.applySkill(s, 0, null).state;
  eq([s1.pieces[0].fx.gear, s1.pieces[1].fx.gear, (s1.pieces[2].fx || {}).gear], [1, 1, undefined], "집에 있는 말은 아님");
  const r = Y.applyMove(choose(clone(s1), [2]), "n7/2");
  eq([node(r.state, 1), r.state.pieces[1].fx.gear, r.state.pieces[0].fx.gear], [10, undefined, 1]);
});
t("97. 미스트필드 — 상대 차례 두 번 동안 상대 기술(방해·기술로 잡기)이 우리 팀에 안 통함, 윷으로 잡히는 건 그대로", () => {
  const s = sk({ p0: [["mistyterrain"], ["nitro"]], p1: [["surf"], ["toxic"]], e1: [true, true] });
  put(s, 0, 8); put(s, 1, 4); put(s, 2, 6); put(s, 3, 12);
  const s1 = Y.applySkill(s, 0, null).state;
  ok(Y.isMisted(s1, 0));
  [2, 4].forEach(no => eq(Y.legalSkills(atThrow(s1, no, 1)), [], "차례 " + no + ": 상대 기술이 안 통함"));
  ok(Y.legalSkills(atThrow(s1, 6, 1)).length > 0, "세 번째엔 풀림");
  eq(Y.applyMove(at(s1, 2, 1, [2]), "n6/2").state.pieces[0].state, "wait", "윷으로는 잡힘");
  const f = sk({ p0: [["mistyterrain"], ["nitro"]], p1: [["flame"], ["dracometeor"]], e1: [true, true] }); put(f, 0, 8); put(f, 2, 6); put(f, 3, 2);
  eq(Y.legalSkills(atThrow(Y.applySkill(f, 0, null).state, 2, 1)), [], "화염방사·용성군도 안 통함");
  ok(!Y.legalSkills(atThrow(s1, 3, 0)).some(x => x.key === "mistyterrain"), "이미 켜져 있으면 또 못 씀");
});
t("98. 카운터가 새 기술도 되돌림 — 열풍(쓴 말이 밀림) · 목화포자(쓴 팀 윷) · 용성군(쓴 말이 집으로) · 물붓기(막기만)", () => {
  const c = p0 => sk({ p0, p1: [["counter"], ["counter"]], e1: [true, true] });
  let s = c([["heatwave"], ["nitro"]]); put(s, 0, 7); put(s, 2, 9);
  let r = Y.applySkill(s, 0, null);
  eq([node(r.state, 0), node(r.state, 2)], [5, 9]); ok(evTypes(r).includes("reflect"));
  s = c([["cotton"], ["nitro"]]); put(s, 0, 3); put(s, 2, 9);
  r = Y.applySkill(s, 0, null);
  eq([r.state.teams[0].fx.cotton, !!r.state.teams[1].fx.cotton], [true, false]);
  s = c([["dracometeor"], ["nitro"]]); put(s, 0, 3); put(s, 2, 14);
  r = Y.applySkill(s, 0, 14);
  eq([r.state.pieces[0].state, r.state.pieces[2].state], ["wait", "board"]);
  s = sk({ p0: [["soak"], ["nitro"]], p1: [["counter"], ["nitro"]], e1: [true, true] }); put(s, 0, 3); put(s, 2, 9); put(s, 3, 12);
  r = Y.applySkill(s, 0, 3);
  eq([r.state.pieces[3].used, r.state.pieces[2].used], [false, true], "물붓기는 막히고 카운터만 씀");
});

// ---------- 무작위 대국 (불변 조건 확인) ----------
t("22. 무작위 3,000판 끝까지 — 멈춤·규칙 위반 없음", () => {
  let rs = 99;
  const rnd = () => { const r = Y.rand(rs); rs = r[1]; return r[0]; };
  let longest = 0;
  for (let g = 0; g < 3000; g++) {
    const spotRnd = Y.rng(g + 100);
    let s = Y.newGame({
      pieces: 2 + (g % 3), backdo: g % 4 !== 0, seed: g + 1, first: g % 2,
      spots: g % 2 ? Y.pickSpotNodes(spotRnd, 2).map(node => ({ node, id: 1 + Math.floor(spotRnd() * 1025) })) : undefined,
      teams: [{ name: "A", picks: [6, 25, 1, 7] }, { name: "B", picks: [9, 26, 3, 133] }],
    }, D.evoFrom);
    let steps = 0;
    while (s.phase !== "over") {
      if (++steps > 2000) throw new Error("끝나지 않는 판 (seed " + (g + 1) + ")");
      if (s.phase === "throw") s = Y.applyThrow(s).state;
      else {
        const ms = Y.legalMoves(s);
        ok(ms.length > 0, "choose 인데 둘 수가 없음");
        const m = g % 2 ? Y.cpuChoose(s, "normal", rnd) : ms[Math.floor(rnd() * ms.length)];
        s = Y.applyMove(s, m.id).state;
      }
      ok(Y.validate(s), "validate 실패");
      // 한 칸에 두 팀이 함께 있으면 안 됨, 같은 팀은 같은 길·같은 걸음
      const at = {};
      s.pieces.forEach(p => {
        if (p.state !== "board") return;
        const n = Y.posOf(p);
        if (at[n]) {
          ok(at[n].team === p.team, "칸 " + n + "에 두 팀");
          ok(at[n].route === p.route && at[n].step === p.step && at[n].atGoal === p.atGoal, "업힌 말의 길이 다름");
        } else at[n] = p;
        ok(p.stage < s.teams[p.team].paths[p.slot].length, "진화 단계 범위");
      });
    }
    ok(Y.teamDone(s, s.winner), "이긴 팀 말이 다 안 들어옴");
    longest = Math.max(longest, steps);
  }
  console.log("     (가장 긴 판: 동작 " + longest + "번)");
});

console.log("\n" + pass + "개 통과, " + fail + "개 실패");
process.exit(fail ? 1 : 0);
