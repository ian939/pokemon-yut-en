/* 포켓몬 윷놀이 — 규칙 엔진
 * DOM을 모르는 순수 함수만 둔다. 화면(index.html)은 여기서 받은 결과를 그리기만 한다.
 * 브라우저에서는 window.Yut, Node에서는 require("./yut-rules.js") 로 쓴다.
 * 상태(state)는 JSON 그대로 저장·복원할 수 있는 평범한 객체다.
 */
(function (root) {
  "use strict";

  /* ---------- 윷판: 칸 29개 (좌표 0~100) ----------
   *  10(뒷모)─ 9 ─ 8 ─ 7 ─ 6 ─ 5(모)
   *    │ 25                  20 │
   *   11     26          21     4
   *   12         22(방)          3
   *   13     23          27     2
   *    │ 24                  28 │
   *  15(찌모)─16 ─17 ─18 ─19 ─ 0(참먹이)   ← 참먹이에서 출발, 시계 반대 방향
   */
  const S = 100 / 6;
  const NODES = [
    [100, 100], [100, 80], [100, 60], [100, 40], [100, 20], [100, 0],
    [80, 0], [60, 0], [40, 0], [20, 0], [0, 0],
    [0, 20], [0, 40], [0, 60], [0, 80], [0, 100],
    [20, 100], [40, 100], [60, 100], [80, 100],
    [100 - S, S], [100 - 2 * S, 2 * S], [50, 50], [2 * S, 100 - 2 * S], [S, 100 - S],
    [S, S], [2 * S, 2 * S], [100 - 2 * S, 100 - 2 * S], [100 - S, 100 - S],
  ];
  const NODE_KIND = NODES.map((_, n) =>
    n === 0 ? "start" : (n === 5 || n === 10 || n === 15) ? "corner" : n === 22 ? "center" : "normal");
  const NODE_NAME = { 0: "Start", 5: "Corner", 10: "Corner", 15: "Corner", 22: "Center" }; // 참먹이 · 모 · 뒷모 · 찌모 · 방 (지금 화면에서 안 씀)
  // 그릴 선 (바깥 한 바퀴 + 대각선 두 개)
  const LINES = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 0],
    [5, 20, 21, 22, 23, 24, 15],
    [10, 25, 26, 22, 27, 28, 0],
  ];

  /* ---------- 길 4개 — 앞부분이 겹치게 설계 ---------- */
  const ROUTES = {
    OUT: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 0], // 바깥 한 바퀴 (20걸음)
    A: [0, 1, 2, 3, 4, 5, 20, 21, 22, 23, 24, 15, 16, 17, 18, 19, 0],                // 모 → 방 지나 찌모 (16걸음)
    B: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 25, 26, 22, 27, 28, 0],                    // 뒷모 → 방 → 참먹이 (16걸음)
    C: [0, 1, 2, 3, 4, 5, 20, 21, 22, 27, 28, 0],                                    // 모 → 방에 멈춤 → 참먹이 (11걸음)
  };

  /* 멈춘 칸을 보고 앞으로 갈 길을 정한다 (앞으로 가서 멈추든, 빽도로 물러나 멈추든 똑같이).
   * - 모(5)·뒷모(10)에 멈추면 대각선, 방(22)에 멈추면 참먹이 쪽 (B로 왔으면 이미 참먹이 쪽)
   * - 그 밖의 칸은 "그 칸을 멈추지 않고 지나가던 말"이 가는 길
   *   → 모에서 빽도로 4에 물러난 말이 다시 개를 던지면 모를 지나 6으로 간다 (대각선 아님)
   * - 찌모~아랫변(15~19)과 방→참먹이 대각선(27·28)은 앞으로 가는 길이 어느 길이든 같아서,
   *   빽도로 되짚을 길이 다르게 남도록 온 길을 그대로 둔다 (15에서 빽도: 바깥으로 왔으면 14, 대각선으로 왔으면 24) */
  function settle(route, node) {
    if (node === 5) return { route: "A", step: 5 };
    if (node === 10) return { route: "B", step: 10 };
    if (node >= 1 && node <= 14) return { route: "OUT", step: node };
    if (node === 20 || node === 21 || node === 23 || node === 24) return { route: "A", step: node - 14 };
    if (node === 25 || node === 26) return { route: "B", step: node - 14 };
    if (node === 22) return route === "B" ? { route: "B", step: 13 } : { route: "C", step: 8 };
    let step = ROUTES[route] ? ROUTES[route].indexOf(node) : -1;
    if (step > 0) return { route, step };
    const alt = (node === 27 || node === 28) ? "C" : "OUT"; // 안전장치 (정상 흐름에서는 오지 않음)
    return { route: alt, step: ROUTES[alt].indexOf(node) };
  }

  /* ---------- 윷 결과 ---------- */
  const BACKDO = -1;
  const RESULTS = {
    "-1": { name: "Back-do", steps: -1, again: false },
    1: { name: "Do", steps: 1, again: false },
    2: { name: "Gae", steps: 2, again: false },
    3: { name: "Geol", steps: 3, again: false },
    4: { name: "Yut", steps: 4, again: true },
    5: { name: "Mo", steps: 5, again: true },
  };
  const FLAT_P = 0.6; // 윷가락 하나가 평평한 면으로 떨어질 확률

  // 시드 난수 (mulberry32) — 상태를 숫자 하나로 저장해 판을 이어해도 같은 흐름이 된다
  function rand(st) {
    const a = (st + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return [((t ^ (t >>> 14)) >>> 0) / 4294967296, a >>> 0];
  }

  // 윷가락 4개 던지기. sticks[i] = 평평한 면이 위인가. 0번 가락이 빽도 표시 가락.
  function throwSticks(st, backdo, flatP) {
    const p = flatP == null ? FLAT_P : flatP;
    const sticks = [];
    for (let i = 0; i < 4; i++) {
      const r = rand(st);
      st = r[1];
      sticks.push(r[0] < p);
    }
    const n = sticks.filter(Boolean).length;
    let result = n === 0 ? 5 : n;
    if (n === 1 && sticks[0] && backdo) result = BACKDO;
    return { result, sticks, rng: st };
  }
  // 강제로 정한 결과(테스트·시연)에 맞는 가락 모양
  function sticksFor(r) {
    return {
      "-1": [true, false, false, false], 1: [false, true, false, false], 2: [false, true, true, false],
      3: [false, true, true, true], 4: [true, true, true, true], 5: [false, false, false, false],
    }[r].slice();
  }
  // 결과별 확률 (CPU가 위험을 계산할 때 사용)
  function resultProbs(backdo, flatP) {
    const p = flatP == null ? FLAT_P : flatP, q = 1 - p;
    const C = [1, 4, 6, 4, 1];
    const k = n => C[n] * Math.pow(p, n) * Math.pow(q, 4 - n);
    const P = { 1: k(1), 2: k(2), 3: k(3), 4: k(4), 5: k(0) };
    if (backdo) { P[BACKDO] = P[1] / 4; P[1] -= P[BACKDO]; }
    return P;
  }

  /* ---------- 말 위치 ---------- */
  const clone = o => JSON.parse(JSON.stringify(o));
  const posOf = p => (p.state !== "board" ? null : p.atGoal ? 0 : ROUTES[p.route][p.step]);

  // 한 칸 이동 계산. from: { route, step, atGoal } (새 말은 route OUT·step 0)
  // 돌려주는 값: { finish, node, route, step, atGoal, path(지나가는 칸 순서) } 또는 null(움직일 수 없음)
  function stepMove(from, r) {
    if (r === BACKDO) {
      if (from.entering || from.atGoal) return null; // 대기 중인 말·참먹이 위의 말은 빽도로 움직이지 않음
      const s = from.step - 1;
      if (s <= 0) return { finish: false, node: 0, route: "OUT", step: 0, atGoal: true, path: [0] };
      const node = ROUTES[from.route][s];
      const st = settle(from.route, node);
      return { finish: false, node, route: st.route, step: st.step, atGoal: false, path: [node] };
    }
    if (from.atGoal) return { finish: true, node: null, path: [] }; // 참먹이 위 → 앞으로 한 칸이라도 가면 완주
    const R = ROUTES[from.route], last = R.length - 1;
    const s = from.step + r;
    if (s >= last) return { finish: true, node: null, path: R.slice(from.step + 1, last + 1) };
    const node = R[s];
    const st = settle(from.route, node);
    return { finish: false, node, route: st.route, step: st.step, atGoal: false, path: R.slice(from.step + 1, s + 1) };
  }

  // 팀의 판 위 말을 칸별로 묶기 (같은 칸 = 업힌 말)
  function unitsOf(state, team) {
    const byNode = {};
    state.pieces.forEach((p, i) => {
      if (p.team !== team || p.state !== "board") return;
      const n = posOf(p);
      if (!byNode[n]) byNode[n] = { node: n, pieces: [], route: p.route, step: p.step, atGoal: p.atGoal };
      byNode[n].pieces.push(i);
    });
    return Object.keys(byNode).map(k => byNode[k]);
  }
  const waitingOf = (state, team) =>
    state.pieces.map((p, i) => i).filter(i => state.pieces[i].team === team && state.pieces[i].state === "wait");

  /* ---------- 칸·말 찾기 ---------- */
  const piecesAt = (s, node) => s.pieces.map((p, i) => i).filter(i => s.pieces[i].state === "board" && posOf(s.pieces[i]) === node);
  const others = (s, team) => s.teams.map((_, t) => t).filter(t => t !== team);
  function unitOfPiece(s, i) {
    const p = s.pieces[i];
    if (!p || p.state !== "board") return null;
    return unitsOf(s, p.team).find(u => u.pieces.indexOf(i) >= 0) || null;
  }
  const enemyUnits = (s, team) => [].concat(...others(s, team).map(t => unitsOf(s, t)));

  /* ---------- v3: 상태 효과 ----------
   * 효과는 "몇 번째 차례(turnNo)까지"로 적는다 — 그 차례가 끝나면 풀린다.
   *   말 fx: para(마비) · sleep(잠) · veil(얼음 장막)   팀 fx: poison(다음 윷 빽도) · seal(기술 봉인) · rain(비)
   * v8: 못 움직임 freeze(아이스차징) · tired(지침: 와일드볼트·역린) · spike(독압정) — k+"From" 이 있으면 그 차례부터
   *     숨음 dig(구멍파기 — 장막처럼) · 횟수 bulk(+1칸) · weak(−1칸) · digup(+1칸) · confuse(다음 이동 뒤로)   팀 fx: chill(그 차례 윷이 빽도·도·개만) */
  const fxP = p => p.fx || {};
  const BLOCKS = ["para", "sleep", "freeze", "tired", "spike"];
  const blockOn = (s, f, k) => (f[k] || 0) >= s.turnNo && (f[k + "From"] || 0) <= s.turnNo;
  const isBlocked = (s, p) => { const f = fxP(p); return BLOCKS.some(k => blockOn(s, f, k)); };
  const isVeiled = (s, p) => (fxP(p).veil || 0) >= s.turnNo || (fxP(p).dig || 0) >= s.turnNo;
  const cnt = (s, u, k) => u.pieces.some(i => (fxP(s.pieces[i])[k] || 0) > 0);
  // 윷으로 앞으로 갈 때 더하고 빼는 칸 (💪 벌크업 +1 · 🕳️ 구멍파기 다음 이동 +1 · 🧪 독찌르기 −1)
  const stepMod = (s, u) => (cnt(s, u, "bulk") ? 1 : 0) + (cnt(s, u, "digup") ? 1 : 0) - (cnt(s, u, "weak") ? 1 : 0);
  const isConfused = (s, u) => cnt(s, u, "confuse");
  const teamFx = (s, t) => s.teams[t].fx || (s.teams[t].fx = {});
  const isSealed = (s, t) => ((s.teams[t].fx || {}).seal || 0) >= s.turnNo;
  const isRaining = (s, t) => ((s.teams[t].fx || {}).rain || 0) >= s.turnNo;
  const pfx = p => p.fx || (p.fx = {});
  // 팀 t 의 k번째 다음 차례 (지금이 t 차례면 이번 차례는 빼고 센다)
  function untilFor(s, t, k) {
    const n = s.teams.length;
    let off = (t - s.turn + n) % n;
    if (off === 0) off = n;
    return s.turnNo + off + n * (k - 1);
  }
  const unitBlocked = (s, u) => u.pieces.some(i => isBlocked(s, s.pieces[i]));
  const unitVeiled = (s, u) => u.pieces.some(i => isVeiled(s, s.pieces[i]));
  const veiledEnemyAt = (s, team, node) => piecesAt(s, node).some(i => s.pieces[i].team !== team && isVeiled(s, s.pieces[i]));

  /* ---------- v3: 함정 (바위·거미줄 · v8 독압정) — 그 칸이 비어 있을 때만 걸린다 ---------- */
  const trapAt = (s, node, kind) => (s.traps || []).find(t => t.node === node && (!kind || t.kind === kind)) || null;
  function activeTrap(s, team, node, kind) {
    const t = trapAt(s, node, kind);
    return t && t.team !== team && !piecesAt(s, node).length ? t : null;
  }
  function removeTrap(s, node) { s.traps = (s.traps || []).filter(t => t.node !== node); }
  // 같은 칸의 우리 말은 한 덩어리(업힘) — 길·걸음을 맞춘다 (밀려나거나 달빛·순풍으로 와서 겹칠 때)
  function unify(s, node, team, pos) {
    piecesAt(s, node).forEach(i => { if (s.pieces[i].team === team) Object.assign(s.pieces[i], { route: pos.route, step: pos.step, atGoal: !!pos.atGoal }); });
  }
  // 상대 거미줄을 지나가면 그 칸에서 멈춘다 (골인하는 마지막 칸 = 참먹이에는 거미줄이 없다)
  function cutAtWeb(s, team, from, d) {
    if (!d || !s.traps || !s.traps.length) return d;
    for (let k = 0; k < d.path.length; k++) {
      if (d.finish && k === d.path.length - 1) break;
      const n = d.path[k];
      if (!activeTrap(s, team, n, "web")) continue;
      const st = (!d.finish && k === d.path.length - 1) ? { route: d.route, step: d.step } : settle(from.route, n);
      return { finish: false, node: n, route: st.route, step: st.step, atGoal: false, path: d.path.slice(0, k + 1), web: n };
    }
    return d;
  }
  // 뒤로 n칸 (빽도를 n번). 1칸째보다 뒤로는 안 간다 — 참먹이로 물러나 바로 골인하는 꼼수 막기
  function backSteps(from, n) {
    const list = [];
    let cur = { route: from.route, step: from.step, atGoal: !!from.atGoal };
    for (let k = 0; k < n; k++) {
      if (cur.atGoal || cur.step <= 1) break;
      const d = stepMove(cur, BACKDO);
      if (!d || d.atGoal) break;
      cur = { node: d.node, route: d.route, step: d.step, atGoal: false };
      list.push(cur);
    }
    return list;
  }

  /* ---------- 둘 수 있는 수 ---------- */
  function makeMove(state, team, r, ri, unit, pieces, from, d) {
    const m = {
      id: unit + "/" + r, unit, result: r, ri, pieces: pieces.slice(),
      from: { node: from.node, route: from.route, step: from.step, atGoal: !!from.atGoal },
      to: d.finish ? null : { node: d.node, route: d.route, step: d.step, atGoal: d.atGoal },
      path: d.path, finish: d.finish, capture: [], stack: [], web: d.web || null, rock: false,
    };
    if (!d.finish) {
      state.pieces.forEach((p, i) => {
        if (p.state !== "board" || posOf(p) !== d.node || m.pieces.indexOf(i) >= 0) return;
        (p.team === team ? m.stack : m.capture).push(i);
      });
      m.rock = !!activeTrap(state, team, d.node, "rock");
      m.spike = !!activeTrap(state, team, d.node, "spike");
    }
    return m;
  }
  // 앞으로 r칸 (거미줄에서 멈춤, 얼음 장막 친 상대 칸에는 못 멈춤)
  function planForward(s, team, from, r) {
    const d = cutAtWeb(s, team, from, stepMove(from, r));
    if (!d || (!d.finish && veiledEnemyAt(s, team, d.node))) return null;
    return d;
  }

  function legalMoves(state) {
    if (state.phase !== "choose") return [];
    const t = state.turn;
    const out = [];
    const seen = {};
    const units = unitsOf(state, t).filter(u => !unitBlocked(state, u)); // 마비·잠든 말은 못 움직인다
    const waiting = waitingOf(state, t);
    state.pending.forEach((r, ri) => {
      if (seen[r]) return; // 같은 결과가 두 번이면 한 번만 (어느 쪽을 써도 같다)
      seen[r] = true;
      units.forEach(u => {
        if (r > 0 && isConfused(state, u)) { // 💋 헷갈림: 윷 결과만큼 뒤로
          const m = makeMove(state, t, r, ri, "n" + u.node, u.pieces, u, confusedPlan(state, t, u, r));
          m.confused = true;
          out.push(m);
          return;
        }
        const n = r > 0 ? r + stepMod(state, u) : r;
        if (n === 0) return; // 🧪 약해진 말은 도로 못 움직인다
        const d = planForward(state, t, u, n);
        if (d) out.push(makeMove(state, t, r, ri, "n" + u.node, u.pieces, u, d));
      });
      if (r > 0 && waiting.length) {
        const from = { node: -1, route: "OUT", step: 0, atGoal: false };
        const d = planForward(state, t, from, r);
        if (d) out.push(makeMove(state, t, r, ri, "new", [waiting[0]], from, d));
      }
    });
    return out;
  }

  /* ---------- 진화 — 앞으로 간 칸 수로 5칸마다 한 단계 (v3) ---------- */
  const EVO_STEP = 5;
  // 진화 경로: 1단계 → … → 고른 포켓몬.  evoPath(6) = [4, 5, 6]
  function evoPath(id, evoFrom) {
    const path = [id];
    const seen = {};
    while (evoFrom && evoFrom[path[0]] && !seen[path[0]] && path.length < 4) {
      seen[path[0]] = true;
      path.unshift(evoFrom[path[0]]);
    }
    return path;
  }
  // (v2까지의 진화 규칙 — 길의 비율. 지금은 쓰지 않지만 옛 도구와 테스트를 위해 남겨 둔다)
  function progressOf(p) {
    if (p.state === "done") return 1;
    if (p.state !== "board" || p.atGoal) return 0;
    return p.step / (ROUTES[p.route].length - 1);
  }
  const stageFor = (progress, len) => Math.max(0, Math.min(len - 1, Math.floor(progress * len + 1e-9)));
  const formOf = (state, i) => {
    const p = state.pieces[i];
    const path = state.teams[p.team].paths[p.slot];
    return path[Math.min(p.stage, path.length - 1)];
  };
  const lastStage = (s, i) => s.teams[s.pieces[i].team].paths[s.pieces[i].slot].length - 1;
  // 기술을 쓸 수 있는가 (v4, 사용자 확정 2026-09-26)
  //  - 3단계 진화 포켓몬: 마지막 모습이 되면 (10칸)
  //  - 진화 없음 · 2단계 · 전설(early): 15칸을 가야 (처음부터·5칸에 쓰면 불공평해서)
  //  - now[slot]: 시험용 — 처음부터 쓸 수 있음
  const SKILL_WALK = 15;
  const needsWalk = (s, i) => {
    const p = s.pieces[i], t = s.teams[p.team];
    return lastStage(s, i) < 2 || !!(t.early && t.early[p.slot]);
  };
  // v8 (사용자 확정 2026-09-28): 모두 10칸 — 화면 쪽이 need 를 10으로 넘긴다
  // v5 (사용자 확정 2026-09-27): 희귀도로 기술까지 필요한 칸 — 일반 15 · 레어 10 · 유니크 5 · 전설 처음부터.
  // 화면 쪽이 말마다 need 를 정해 넘긴다 (마지막 모습이 아니어도 된다). need 가 없으면(옛 판·시험) 위의 v4 규칙
  function skillNeed(s, i) {
    const p = s.pieces[i], t = s.teams[p.team];
    if (t.now && t.now[p.slot]) return 0;
    if (Array.isArray(t.need) && t.need[p.slot] != null) return t.need[p.slot];
    const evo = (lastStage(s, i) - (p.base || 0)) * EVO_STEP;
    return needsWalk(s, i) ? Math.max(evo, SKILL_WALK) : evo;
  }
  function isFinal(s, i) {
    const p = s.pieces[i], t = s.teams[p.team];
    if (t.now && t.now[p.slot]) return true;
    if (Array.isArray(t.need) && t.need[p.slot] != null) return (p.walk || 0) >= t.need[p.slot];
    if (p.stage < lastStage(s, i)) return false;
    return !needsWalk(s, i) || (p.walk || 0) >= SKILL_WALK;
  }
  function srand(s) { const r = rand(s.srng || 1); s.srng = r[1]; return r[0]; }
  // 기술 배우기 — 마지막 모습이 되는 순간 후보(그 모습의 타입 기술) 중에서 무작위로 하나. 한 번 배우면 그대로
  function learn(s, ev, i, force) {
    const p = s.pieces[i], t = s.teams[p.team];
    if (s.settings.skills === false || p.skill || p.state === "done" || (!force && !isFinal(s, i))) return;
    const pool = ((t.pools && t.pools[p.slot]) || []).filter(k => SKILLS[k]);
    if (!pool.length) return;
    p.skill = pool[Math.floor(srand(s) * pool.length)];
    p.used = false;
    if (ev) ev.push({ type: "learn", piece: i, key: p.skill, team: p.team });
  }
  function evolveCheck(s, ev, pieces) {
    pieces.forEach(i => {
      const p = s.pieces[i];
      const last = lastStage(s, i);
      const target = p.state === "done" ? last : Math.min(last, (p.base || 0) + Math.floor((p.walk || 0) / EVO_STEP));
      if (target > p.stage) {
        ev.push({ type: "evolve", piece: i, from: p.stage, to: target });
        p.stage = target;
      }
      learn(s, ev, i);
    });
  }
  // 집으로 — 처음 모습(바꿔 들어온 말은 잡은 모습)으로, 센 칸은 0부터, 효과는 풀린다. 안 쓴 기술은 남는다
  // 집으로 — 자리만 출발 칸으로. 진화한 모습·온 칸 수는 지킨다 (사용자 확정 2026-09-28: 잡혀도 진화한 모습 그대로), 효과는 풀린다
  // 골인: 아직 기술을 못 배웠으면 들어오면서 배운다 (사용자 확정 2026-09-29 — 10칸 전에 윷·모로 골인해도) → 못 쓴 기술은 팀원에게
  // 업혀서 같이 들어온 말은 모두 골인시킨 뒤에 넘긴다 (골인한 팀원이 받지 않게)
  function finishPieces(s, ev, pieces) {
    pieces.forEach(i => learn(s, ev, i, true));
    pieces.forEach(i => Object.assign(s.pieces[i], { state: "done", atGoal: false, fx: {} }));
    pieces.forEach(i => passSkills(s, ev, i));
  }
  function sendHome(s, i) {
    const p = s.pieces[i];
    Object.assign(p, { state: "wait", route: "OUT", step: 0, atGoal: false, fx: {} });
  }

  /* ---------- v8: 기술 36개 (타입마다 2개, 사용자 확정 2026-09-28) ----------
   * kind: active(내가 골라 씀) · react(때가 되면 저절로)
   * when: any(내 차례 아무 때) · throw(던지기 전) · pending(남은 결과가 있을 때)
   * target: none · enemy(상대 말 칸) · enemyPiece(상대 말) · ally(우리 말 칸) · node(빈 칸) · pending(남은 결과) · result(결과 고르기) · move(뒤로 갈 결과)
   * cat: 로켓단 쉬움은 attack·trap·random 을 안 쓴다 */
  const SKILLS = {
    metronome: { name: "Metronome", type: "노말", kind: "active", when: "any", target: "none", cat: "random" },
    wish: { name: "Wish", type: "노말", kind: "active", when: "throw", target: "result", cat: "throw" },
    nitro: { name: "Flame Charge", type: "불꽃", kind: "active", when: "any", target: "none", cat: "move" },
    flame: { name: "Flamethrower", type: "불꽃", kind: "active", when: "any", target: "enemy", cat: "attack" },
    surf: { name: "Surf", type: "물", kind: "active", when: "any", target: "enemy", cat: "attack" },
    rain: { name: "Rain Dance", type: "물", kind: "active", when: "any", target: "none", cat: "throw" },
    growth: { name: "Growth", type: "풀", kind: "active", when: "pending", target: "pending", cat: "throw" },
    sleep: { name: "Sleep Powder", type: "풀", kind: "active", when: "any", target: "enemy", cat: "attack" },
    discharge: { name: "Discharge", type: "전기", kind: "active", when: "any", target: "none", cat: "attack" },
    wildcharge: { name: "Wild Charge", type: "전기", kind: "active", when: "any", target: "none", cat: "move" },
    veil: { name: "Aurora Veil", type: "얼음", kind: "active", when: "any", target: "none", cat: "guard" },
    icecharge: { name: "Ice Beam", type: "얼음", kind: "active", when: "any", target: "enemy", cat: "attack" },
    counter: { name: "Counter", type: "격투", kind: "react", cat: "guard" },
    bulkup: { name: "Bulk Up", type: "격투", kind: "active", when: "any", target: "none", cat: "move" },
    toxic: { name: "Toxic", type: "독", kind: "active", when: "any", target: "none", cat: "attack" },
    poisonjab: { name: "Poison Jab", type: "독", kind: "active", when: "any", target: "enemy", cat: "attack" },
    quake: { name: "Earthquake", type: "땅", kind: "active", when: "any", target: "none", cat: "attack" },
    dig: { name: "Dig", type: "땅", kind: "active", when: "any", target: "none", cat: "guard" },
    fly: { name: "Fly", type: "비행", kind: "active", when: "any", target: "none", cat: "move" },
    tailwind: { name: "Tailwind", type: "비행", kind: "active", when: "any", target: "none", cat: "move" },
    future: { name: "Future Sight", type: "에스퍼", kind: "active", when: "throw", target: "result", cat: "throw" },
    allyswitch: { name: "Ally Switch", type: "에스퍼", kind: "active", when: "any", target: "enemy", cat: "move" }, // v8: 우리 말 ↔ 상대 말
    uturn: { name: "U-turn", type: "벌레", kind: "active", when: "pending", target: "move", cat: "move" },
    web: { name: "Sticky Web", type: "벌레", kind: "active", when: "any", target: "node", cat: "trap" },
    rock: { name: "Stealth Rock", type: "바위", kind: "active", when: "any", target: "node", cat: "trap" },
    stoneedge: { name: "Stone Edge", type: "바위", kind: "active", when: "any", target: "none", cat: "attack" },
    spite: { name: "Spite", type: "고스트", kind: "active", when: "any", target: "none", cat: "attack" },
    bond: { name: "Destiny Bond", type: "고스트", kind: "react", cat: "guard" },
    ddance: { name: "Dragon Dance", type: "드래곤", kind: "active", when: "any", target: "none", cat: "move" },
    outrage: { name: "Outrage", type: "드래곤", kind: "active", when: "any", target: "none", cat: "attack" },
    snatch: { name: "Snatch", type: "악", kind: "active", when: "any", target: "enemyPiece", cat: "attack" },
    spike: { name: "Toxic Spikes", type: "악", kind: "active", when: "any", target: "node", cat: "trap" },
    iron: { name: "Iron Defense", type: "강철", kind: "react", cat: "guard" },
    magnet: { name: "Magnet Pull", type: "강철", kind: "active", when: "any", target: "ally", cat: "move" },
    moon: { name: "Moonlight", type: "페어리", kind: "react", cat: "guard" },
    kiss: { name: "Sweet Kiss", type: "페어리", kind: "active", when: "any", target: "enemy", cat: "attack" },
  };
  const TYPE_SKILLS = {
    "노말": ["metronome", "wish"], "불꽃": ["nitro", "flame"], "물": ["surf", "rain"], "풀": ["growth", "sleep"],
    "전기": ["discharge", "wildcharge"], "얼음": ["veil", "icecharge"], "격투": ["counter", "bulkup"], "독": ["toxic", "poisonjab"], "땅": ["quake", "dig"],
    "비행": ["fly", "tailwind"], "에스퍼": ["future", "allyswitch"], "벌레": ["uturn", "web"], "바위": ["rock", "stoneedge"],
    "고스트": ["spite", "bond"], "드래곤": ["ddance", "outrage"], "악": ["snatch", "spike"], "강철": ["iron", "magnet"], "페어리": ["moon", "kiss"],
  };
  // v8: 없어진 기술 → 새 기술 (옛 판 이어 하기)
  const RENAMED = { haze: "icecharge", twave: "discharge" };
  // 카운터가 되돌리는 방해 기술
  const REFLECTABLE = ["surf", "discharge", "sleep", "flame", "quake", "toxic", "spite", "snatch", "icecharge", "poisonjab", "kiss", "stoneedge", "outrage", "allyswitch"];

  /* ---------- v8: 🎲 기술 발동 확률 (사용자 확정 2026-09-28) ----------
   * 쓰는 말의 희귀도: 일반 60 · 레어 70 · 유니크 80 · 전설 90%. 상대 말 하나에 거는 기술이면 타입 상성으로 ±10%
   * 희귀도(teams[].rar)·타입(teams[].types[말][단계])은 화면 쪽이 넘긴다. 없으면(옛 시험) 늘 성공 */
  const CHANCE = { c: 0.6, r: 0.7, u: 0.8, l: 0.9 };
  const MATCH_SKILLS = ["flame", "surf", "sleep", "icecharge", "poisonjab", "allyswitch", "stoneedge", "kiss", "snatch"];
  // 원작 상성표: 공격 타입 → { 2: 효과가 굉장함, h: 별로, 0: 안 통함 }
  const TYPE_CHART = {
    "노말": { h: "바위 강철", 0: "고스트" },
    "불꽃": { 2: "풀 얼음 벌레 강철", h: "불꽃 물 바위 드래곤" },
    "물": { 2: "불꽃 땅 바위", h: "물 풀 드래곤" },
    "전기": { 2: "물 비행", h: "전기 풀 드래곤", 0: "땅" },
    "풀": { 2: "물 땅 바위", h: "불꽃 풀 독 비행 벌레 드래곤 강철" },
    "얼음": { 2: "풀 땅 비행 드래곤", h: "불꽃 물 얼음 강철" },
    "격투": { 2: "노말 얼음 바위 악 강철", h: "독 비행 에스퍼 벌레 페어리", 0: "고스트" },
    "독": { 2: "풀 페어리", h: "독 땅 바위 고스트", 0: "강철" },
    "땅": { 2: "불꽃 전기 독 바위 강철", h: "풀 벌레", 0: "비행" },
    "비행": { 2: "풀 격투 벌레", h: "전기 바위 강철" },
    "에스퍼": { 2: "격투 독", h: "에스퍼 강철", 0: "악" },
    "벌레": { 2: "풀 에스퍼 악", h: "불꽃 격투 독 비행 고스트 강철 페어리" },
    "바위": { 2: "불꽃 얼음 비행 벌레", h: "격투 땅 강철" },
    "고스트": { 2: "에스퍼 고스트", h: "악", 0: "노말" },
    "드래곤": { 2: "드래곤", h: "강철", 0: "페어리" },
    "악": { 2: "에스퍼 고스트", h: "격투 악 페어리" },
    "강철": { 2: "얼음 바위 페어리", h: "불꽃 물 전기 강철" },
    "페어리": { 2: "격투 드래곤 악", h: "불꽃 독 강철" },
  };
  function typeEff(atk, def) {
    const c = TYPE_CHART[atk];
    if (!c) return 1;
    const has = k => (c[k] || "").split(" ").indexOf(def) >= 0;
    return has(2) ? 2 : has("h") ? 0.5 : has(0) ? 0 : 1;
  }
  function rarOf(s, i) { const p = s.pieces[i], t = s.teams[p.team]; return Array.isArray(t.rar) ? t.rar[p.slot] : null; }
  function typesAt(s, j) {
    const q = s.pieces[j], T = (s.teams[q.team].types || [])[q.slot];
    return Array.isArray(T) && T.length ? T[Math.min(q.stage, T.length - 1)] || null : null;
  }
  const FLY_STOPS = [5, 10, 15, 22]; // 공중날기: 모·뒷모·찌모·방 (참먹이면 골인)

  // 저절로 기술이 나갈 수 있는가 (마비·잠이어도 나간다, 봉인이면 쉰다)
  /* 🎁 받은 기술 (v5, 사용자 확정 2026-09-27): 기술을 못 쓰고 골인한 팀원의 기술을 고른 팀원이 받는다.
   * 말 하나가 기술을 두 개까지 — 제 기술(skill) + 받은 기술(gift). 받은 기술은 칸 수와 상관없이 판 위에서 바로 쓸 수 있다 */
  const giftReady = p => !!(p && p.gift && !p.gift.used && SKILLS[p.gift.key]);
  const ownReady = (s, i) => { const p = s.pieces[i]; return !!(p.skill && !p.used && isFinal(s, i)); };
  function canReact(s, i, key) {
    const p = s.pieces[i];
    if (s.settings.skills === false || p.state !== "board" || isSealed(s, p.team)) return false;
    return (p.skill === key && ownReady(s, i)) || (giftReady(p) && p.gift.key === key);
  }
  // 저절로 기술을 쓴 것으로 — 제 기술이 그 기술이면 제 것, 아니면 받은 것
  function spend(s, i, key) {
    const p = s.pieces[i];
    if (p.skill === key && ownReady(s, i)) p.used = true;
    else if (giftReady(p) && p.gift.key === key) p.gift.used = true;
    else p.used = true;
  }
  function findReact(s, team, key) {
    for (let i = 0; i < s.pieces.length; i++) if (s.pieces[i].team === team && canReact(s, i, key)) return i;
    return null;
  }
  // 누르는 기술을 쓸 수 있는 말인가 (대상은 targetsFor 로 따로 본다)
  // slot: "own"(제 기술) | "gift"(받은 기술) → 쓸 수 있으면 그 기술 key, 아니면 null
  function slotKey(s, i, slot) {
    const p = s.pieces[i];
    return slot === "gift" ? (giftReady(p) ? p.gift.key : null) : (ownReady(s, i) ? p.skill : null);
  }
  function canUse(s, i, slot) {
    const p = s.pieces[i];
    if (s.settings.skills === false || (s.phase !== "throw" && s.phase !== "choose")) return false;
    if (p.team !== s.turn || p.state !== "board") return false;
    const key = slotKey(s, i, slot || "own");
    if (!key || SKILLS[key].kind !== "active") return false;
    return s.skillTurn !== s.turnNo && !isSealed(s, p.team) && !isBlocked(s, p);
  }

  // 🗿 스톤에지가 노리는 말: 뒤로 밀 수 있는 상대 중 골인에 가장 가까운 말
  function leadFoe(s, team) {
    const rem = x => x.atGoal ? 0 : remainingOf(x.route, x.step);
    const c = enemyUnits(s, team).filter(x => !unitVeiled(s, x) && canPushBack(s, x)).sort((a, b) => rem(a) - rem(b));
    return c[0] || null;
  }
  // 🐲 역린: 앞쪽 1~2칸의 상대 말
  function outrageFoes(s, team, u) {
    const nodes = [1, 2].map(r => stepMove(u, r)).filter(d => d && !d.finish).map(d => d.node);
    return enemyUnits(s, team).filter(x => !unitVeiled(s, x) && nodes.indexOf(x.node) >= 0);
  }
  // 💋 헷갈린 말: 윷 결과만큼 뒤로 (1칸째보다 뒤로 안 감, 상대 말 칸 앞에서 멈춤, 못 가면 제자리)
  function confusedPlan(s, team, u, r) {
    let cur = { route: u.route, step: u.step, atGoal: !!u.atGoal };
    const path = [];
    for (let k = 0; k < r; k++) {
      const nx = backSteps(cur, 1)[0];
      if (!nx || piecesAt(s, nx.node).some(j => s.pieces[j].team !== team)) break;
      cur = nx;
      path.push(nx.node);
    }
    if (!path.length) return { finish: false, node: u.node, route: u.route, step: u.step, atGoal: !!u.atGoal, path: [] };
    return { finish: false, node: cur.node, route: cur.route, step: cur.step, atGoal: false, path };
  }
  // 기술이 맞는 상대 말들 (상성 계산용)
  function matchPieces(s, i, key, tg) {
    const team = s.pieces[i].team;
    if (key === "snatch") return tg != null ? [tg] : [];
    if (key === "stoneedge") { const x = leadFoe(s, team); return x ? x.pieces : []; }
    const x = enemyUnits(s, team).find(y => y.node === tg);
    return x ? x.pieces : [];
  }
  // 상성: +1 효과가 굉장함 · −1 별로 · 0 보통 (업힌 말은 가장 잘 통하는 말 기준)
  function matchup(s, i, key, tg) {
    if (MATCH_SKILLS.indexOf(key) < 0) return 0;
    let best = null;
    matchPieces(s, i, key, tg).forEach(j => {
      const T = typesAt(s, j);
      if (!T) return;
      const m = T.reduce((a, d) => a * typeEff(SKILLS[key].type, d), 1);
      if (best == null || m > best) best = m;
    });
    return best == null ? 0 : best > 1 ? 1 : best < 1 ? -1 : 0;
  }
  // { chance, base, match } — 희귀도가 없으면 늘 성공
  function skillChance(s, i, key, tg) {
    const base = CHANCE[rarOf(s, i)];
    if (!base) return { chance: 1, base: 1, match: 0 };
    const match = SKILLS[key] && SKILLS[key].kind === "active" ? matchup(s, i, key, tg) : 0;
    return { chance: Math.max(0.05, Math.min(1, Math.round((base + 0.1 * match) * 100) / 100)), base, match };
  }
  // 저절로 기술이 나갈지 (희귀도 확률만). 실패해도 기술은 쓴 것으로 (사용자 확정 2026-09-29)
  function reactRoll(s, ev, j, key) {
    const c = skillChance(s, j, key, null).chance;
    if (c >= 1 || srand(s) < c) return true;
    spend(s, j, key);
    ev.push({ type: "reactfail", piece: j, key, team: s.pieces[j].team, chance: c });
    return false;
  }

  function flyPlan(s, team, u) {
    if (u.atGoal) return { finish: true, node: null, path: [] };
    const R = ROUTES[u.route], last = R.length - 1;
    for (let k = u.step + 1; k <= last; k++) {
      if (k === last) return { finish: true, node: null, path: R.slice(u.step + 1, last + 1) };
      const n = R[k];
      if (FLY_STOPS.indexOf(n) < 0) continue;
      if (veiledEnemyAt(s, team, n)) return null;
      const st = settle(u.route, n);
      return { finish: false, node: n, route: st.route, step: st.step, atGoal: false, path: R.slice(u.step + 1, k + 1) };
    }
    return null;
  }
  // 유턴: 뒤로 r칸 (거미줄에 걸리면 거기서 멈춤)
  function backPlan(s, team, u, r) {
    const list = backSteps(u, r);
    if (!list.length) return null;
    const k = list.findIndex(pos => activeTrap(s, team, pos.node, "web"));
    const end = k >= 0 ? k : list.length - 1;
    const stop = list[end];
    if (veiledEnemyAt(s, team, stop.node)) return null;
    return { finish: false, node: stop.node, route: stop.route, step: stop.step, atGoal: false, path: list.slice(0, end + 1).map(p => p.node), web: k >= 0 ? stop.node : null };
  }
  function canPushBack(s, u) {
    const nx = backSteps(u, 1)[0];
    const team = s.pieces[u.pieces[0]].team;
    return !!nx && !piecesAt(s, nx.node).some(i => s.pieces[i].team !== team);
  }
  function trapNodes(s) {
    const out = [];
    for (let n = 1; n < NODES.length; n++) {
      if (piecesAt(s, n).length || trapAt(s, n) || (s.spots || []).some(sp => !sp.used && sp.node === n)) continue;
      out.push(n);
    }
    return out;
  }

  // 말 i 가 기술 key 를 쓸 때 고를 수 있는 대상 (없으면 [] → 못 씀). 대상은 숫자 하나 또는 null
  function targetsFor(s, i, key) {
    const K = SKILLS[key];
    if (!K || K.kind !== "active") return [];
    if (K.when === "throw" && s.phase !== "throw") return [];
    if (K.when === "pending" && !s.pending.length) return [];
    const p = s.pieces[i], team = p.team, u = unitOfPiece(s, i);
    if (!u) return [];
    const opp = others(s, team);
    const foes = enemyUnits(s, team).filter(x => !unitVeiled(s, x));
    switch (key) {
      case "metronome": return metroPool(s, i).length ? [null] : [];
      case "nitro": return planForward(s, team, u, 2) ? [null] : [];
      case "ddance": return planForward(s, team, u, 1) ? [null] : [];
      case "fly": return flyPlan(s, team, u) ? [null] : [];
      case "flame": {
        const out = [];
        [1, 2, 3].forEach(r => {
          const d = stepMove(u, r);
          if (!d || d.finish) return;
          if (foes.some(x => x.node === d.node) && out.indexOf(d.node) < 0) out.push(d.node);
        });
        return out;
      }
      case "surf": return foes.filter(x => canPushBack(s, x)).map(x => x.node);
      case "quake": return foes.some(x => canPushBack(s, x)) ? [null] : [];
      case "sleep": return foes.filter(x => !unitBlocked(s, x)).map(x => x.node);
      case "discharge": return foes.some(x => !unitBlocked(s, x)) ? [null] : [];
      case "wildcharge": return planForward(s, team, u, 3) ? [null] : [];
      case "icecharge": return foes.map(x => x.node);
      case "bulkup": return u.pieces.every(j => (fxP(s.pieces[j]).bulk || 0) >= 2) ? [] : [null];
      case "poisonjab": return foes.filter(x => !x.pieces.every(j => (fxP(s.pieces[j]).weak || 0) >= 2)).map(x => x.node);
      case "dig": return unitVeiled(s, u) ? [] : [null];
      case "stoneedge": return leadFoe(s, team) ? [null] : [];
      case "outrage": return outrageFoes(s, team, u).length ? [null] : [];
      case "kiss": return foes.filter(x => !isConfused(s, x)).map(x => x.node);
      case "magnet": {
        const rem = x => x.atGoal ? 0 : remainingOf(x.route, x.step);
        return unitsOf(s, team).filter(x => x.node !== u.node && rem(x) > rem(u)).map(x => x.node);
      }
      case "toxic": return opp.some(t => !teamFx(s, t).poison) ? [null] : [];
      case "spite": return opp.some(t => !isSealed(s, t)) ? [null] : [];
      case "snatch": return s.pieces.map((q, j) => j).filter(j => {
        const q = s.pieces[j];
        return q.team !== team && q.state !== "done" && q.skill && !q.used && !(q.state === "board" && isVeiled(s, q));
      });
      case "veil": return unitVeiled(s, u) ? [] : [null];
      case "rain": return isRaining(s, team) ? [] : [null];
      case "tailwind": return unitsOf(s, team).some(x => { const d = stepMove(x, 1); return d && (d.finish || !piecesAt(s, d.node).some(j => s.pieces[j].team !== team)); }) ? [null] : [];
      case "allyswitch": return foes.map(x => x.node);
      case "rock": case "web": case "spike": return trapNodes(s);
      case "growth": {
        const seen = {};
        return s.pending.map((r, ri) => ri).filter(ri => { const r = s.pending[ri]; if (r === 5 || seen[r]) return false; seen[r] = 1; return true; });
      }
      case "wish": return [1, 2, 3, 4, 5];
      case "future": return s.guess ? [] : (s.settings.backdo ? [-1, 1, 2, 3, 4, 5] : [1, 2, 3, 4, 5]);
      case "uturn": {
        const out = [];
        s.pending.forEach(r => { if (r > 0 && out.indexOf(r) < 0 && backPlan(s, team, u, r)) out.push(r); });
        return out;
      }
    }
    return [];
  }
  // 손가락흔들기로 나올 수 있는 기술: 지금 쓸 수 있는 누르는 기술 (자기 자신·유턴 빼고)
  function metroPool(s, i) {
    return Object.keys(SKILLS).filter(k => k !== "metronome" && k !== "uturn" && SKILLS[k].kind === "active" && targetsFor(s, i, k).length);
  }
  function legalSkills(state) {
    const out = [];
    state.pieces.forEach((p, i) => ["own", "gift"].forEach(slot => {
      if (!canUse(state, i, slot)) return;
      const key = slotKey(state, i, slot), tg = targetsFor(state, i, key);
      if (tg.length) out.push({ piece: i, key, slot, target: SKILLS[key].target, targets: tg });
    }));
    return out;
  }

  /* ---------- 움직이기 (윷 이동과 기술 이동이 같이 쓴다) ---------- */
  // 잡을 때: 🛡️ 철벽은 부르는 쪽에서 먼저 본다. 🌙 달빛 = 그 말만 한 칸 뒤로, 👻 길동무 = 잡은 말도 집으로
  function moonSpot(s, q) {
    let cur = { route: q.route, step: q.step, atGoal: q.atGoal };
    for (let k = 0; k < 25; k++) {
      const nx = backSteps(cur, 1)[0];
      if (!nx) return null;
      if (!piecesAt(s, nx.node).some(j => s.pieces[j].team !== q.team)) return nx;
      cur = nx;
    }
    return null;
  }
  function captureAt(s, ev, team, attackers, victims, node, info) {
    info = info || {};
    const saved = [];
    let bondBy = null;
    victims.forEach(j => {
      if (canReact(s, j, "moon") && reactRoll(s, ev, j, "moon")) {
        spend(s, j, "moon");
        const pos = moonSpot(s, s.pieces[j]);
        if (pos) saved.push({ piece: j, pos });
      } else if (bondBy == null && canReact(s, j, "bond") && reactRoll(s, ev, j, "bond")) {
        bondBy = j;
        spend(s, j, "bond");
      }
    });
    victims.forEach(j => {
      const sv = saved.find(x => x.piece === j);
      if (sv) { Object.assign(s.pieces[j], { route: sv.pos.route, step: sv.pos.step, atGoal: false }); unify(s, sv.pos.node, s.pieces[j].team, sv.pos); }
      else sendHome(s, j);
    });
    s.throwsLeft += 1; // 잡으면 한 번 더
    ev.push({ type: "capture", node, by: attackers.slice(), victims: victims.slice(), saved: saved.map(x => x.piece), remote: !!info.remote, skill: info.skill || null });
    saved.forEach(x => ev.push({ type: "moon", piece: x.piece, from: node, to: x.pos.node, team: s.pieces[x.piece].team }));
    if (bondBy != null) {
      const at = posOf(s.pieces[attackers[0]]);
      attackers.forEach(j => sendHome(s, j));
      ev.push({ type: "bond", piece: bondBy, pieces: attackers.slice(), node: at, team });
    }
  }
  // opt: { skill, fly(거미줄 무시), back(뒤로 가는 이동 — 진화 칸 수에 안 셈) }
  function doMove(s, ev, team, m, opt) {
    opt = opt || {};
    const back = !!opt.back || m.result < 0;
    ev.push({ type: "move", team, result: m.result, unit: m.unit, pieces: m.pieces.slice(), path: m.path.slice(), from: m.from, to: m.to, finish: m.finish,
      web: m.web || null, fly: !!opt.fly, back, skill: opt.skill || null });
    let captured = false;
    if (m.finish) {
      finishPieces(s, ev, m.pieces);
    } else {
      // 🛡️ 철벽 — 잡으러 온 말이 온 자리로 튕겨 나간다 (한 번 더도 없음)
      if (m.capture.length) {
        const ir = m.capture.find(j => canReact(s, j, "iron"));
        if (ir != null && reactRoll(s, ev, ir, "iron")) {
          spend(s, ir, "iron");
          ev.push({ type: "block", piece: ir, node: m.to.node, pieces: m.pieces.slice(), team, back: m.unit === "new" ? null : m.from.node });
          return { blocked: true };
        }
      }
      m.pieces.forEach(i => Object.assign(s.pieces[i], { state: "board", route: m.to.route, step: m.to.step, atGoal: m.to.atGoal }));
      if (m.web) { removeTrap(s, m.web); ev.push({ type: "webstop", node: m.web, pieces: m.pieces.slice(), team }); }
      // 🪨 바위 — 빈 칸에 멈추면 집으로
      if (!m.capture.length && !m.stack.length && !m.confused) {
        const rk = trapAt(s, m.to.node, "rock");
        if (rk && rk.team !== team) {
          removeTrap(s, m.to.node);
          m.pieces.forEach(i => sendHome(s, i));
          ev.push({ type: "rock", node: m.to.node, pieces: m.pieces.slice(), team });
          return { rocked: true };
        }
        // 🟣 독압정 — 빈 칸에 멈추면 우리 다음 차례에 못 움직인다
        const sp = trapAt(s, m.to.node, "spike");
        if (sp && sp.team !== team) {
          removeTrap(s, m.to.node);
          const at = untilFor(s, team, 1);
          m.pieces.forEach(i => { const f = pfx(s.pieces[i]); f.spike = at; f.spikeFrom = at; });
          ev.push({ type: "status", kind: "spike", pieces: m.pieces.slice(), node: m.to.node, team, skill: "spike" });
        }
      }
      if (m.capture.length) { captureAt(s, ev, team, m.pieces, m.capture, m.to.node, {}); captured = true; }
      if (m.stack.length && m.pieces.every(i => s.pieces[i].state === "board")) {
        m.stack.forEach(i => Object.assign(s.pieces[i], { route: m.to.route, step: m.to.step, atGoal: m.to.atGoal }));
        ev.push({ type: "stack", node: m.to.node, pieces: m.pieces.concat(m.stack) });
      }
    }
    // 진화 — 앞으로 간 칸 수. 5칸마다 한 단계 (뒤로 간 칸은 빼지 않는다, 잡히면 0부터)
    const alive = m.pieces.filter(i => s.pieces[i].state !== "wait");
    if (!back) alive.forEach(i => { s.pieces[i].walk = (s.pieces[i].walk || 0) + m.path.length; });
    evolveCheck(s, ev, alive);
    // ❓ 풀숲 — 딱 멈춘 칸이 아직 안 쓴 풀숲이면 야생 포켓몬 (지나가기·골인 이동은 해당 없음, 한 칸에 한 번)
    // 진화한 뒤에 나오도록 evolve 다음에 둔다
    if (!m.finish && s.spots && m.pieces.every(i => s.pieces[i].state === "board")) {
      const sp = s.spots.find(x => !x.used && x.node === m.to.node);
      if (sp) {
        sp.used = true;
        sp.by = team;
        ev.push({ type: "wild", team, node: sp.node, id: sp.id, pieces: m.pieces.slice() });
      }
    }
    if (m.finish) ev.push({ type: "finish", team, pieces: m.pieces.slice() });
    if (captured) ev.push({ type: "bonus", team });
    return { captured };
  }
  // 뒤로 밀기 (파도타기·지진): 한 칸씩, 다른 팀 말이 있는 칸 앞에서 멈춤, 1칸째보다 뒤로는 안 감. 풀숲·함정은 안 걸림
  function pushUnit(s, ev, u, n, byTeam, key) {
    const team = s.pieces[u.pieces[0]].team;
    const path = [];
    let cur = { route: u.route, step: u.step, atGoal: u.atGoal };
    for (let k = 0; k < n; k++) {
      const nx = backSteps(cur, 1)[0];
      if (!nx || piecesAt(s, nx.node).some(i => s.pieces[i].team !== team)) break;
      cur = nx;
      path.push(nx.node);
    }
    if (path.length) { u.pieces.forEach(i => Object.assign(s.pieces[i], { route: cur.route, step: cur.step, atGoal: false })); unify(s, cur.node, team, cur); }
    ev.push({ type: "push", team, pieces: u.pieces.slice(), from: u.node, to: path.length ? path[path.length - 1] : u.node, path, by: byTeam, skill: key });
  }
  function setStatus(s, ev, pieces, kind, until, key, from) {
    pieces.forEach(i => { const f = pfx(s.pieces[i]); f[kind] = until; if (from != null) f[kind + "From"] = from; else delete f[kind + "From"]; });
    ev.push({ type: "status", kind, pieces: pieces.slice(), node: posOf(s.pieces[pieces[0]]), team: s.pieces[pieces[0]].team, skill: key });
  }
  // 💤 잠: 그 팀 차례 두 번 (첫 번째 차례 20% · 두 번째 50% 로 깬다 — endTurn 에서)
  function setSleep(s, ev, pieces, key) {
    const t = s.pieces[pieces[0]].team;
    setStatus(s, ev, pieces, "sleep", untilFor(s, t, 2), key, untilFor(s, t, 1));
  }
  // 횟수 효과 (벌크업·독찌르기·헷갈림)
  function setCount(s, ev, pieces, kind, n, key) {
    pieces.forEach(i => { pfx(s.pieces[i])[kind] = n; });
    ev.push({ type: "status", kind, pieces: pieces.slice(), node: posOf(s.pieces[pieces[0]]), team: s.pieces[pieces[0]].team, skill: key });
  }
  // 🧊 아이스차징: 그 말은 그 팀 다음 차례에 못 움직이고, 그다음 그 팀 차례 윷은 빽도·도·개만
  function freeze(s, ev, pieces, key) {
    const t = s.pieces[pieces[0]].team, at = untilFor(s, t, 1);
    pieces.forEach(i => { const f = pfx(s.pieces[i]); f.freeze = at; f.freezeFrom = at; });
    teamFx(s, t).chill = untilFor(s, t, 2);
    ev.push({ type: "status", kind: "freeze", pieces: pieces.slice(), node: posOf(s.pieces[pieces[0]]), team: t, skill: key });
  }
  // 😮‍💨 지침 (와일드볼트·역린): 우리 차례 k 번 못 움직임 (이번 차례는 그대로)
  function tire(s, ev, pieces, k, key) {
    const live = pieces.filter(i => s.pieces[i].state === "board");
    if (!live.length) return;
    const t = s.pieces[live[0]].team;
    live.forEach(i => { const f = pfx(s.pieces[i]); f.tired = untilFor(s, t, k); f.tiredFrom = untilFor(s, t, 1); });
    ev.push({ type: "status", kind: "tired", pieces: live.slice(), node: posOf(s.pieces[live[0]]), team: t, skill: key, n: k });
  }
  // ⚡ 방전: 팀 t 의 판 위 말 모두 (장막·구멍 속은 빼고) 그 팀 다음 차례에 못 움직임
  function discharge(s, ev, t, key) {
    const at = untilFor(s, t, 1);
    const us = unitsOf(s, t).filter(x => !unitVeiled(s, x));
    if (!us.length) return;
    const all = [].concat(...us.map(x => x.pieces));
    all.forEach(i => { const f = pfx(s.pieces[i]); f.para = at; f.paraFrom = at; });
    ev.push({ type: "status", kind: "para", pieces: all, nodes: us.map(x => x.node), node: null, team: t, skill: key });
  }
  // 🐲 역린 · 🔥 화염방사: 철벽이 있으면 튕겨 낸다 → true
  function ironBlock(s, ev, team, u, x) {
    const ir = x.pieces.find(j => canReact(s, j, "iron"));
    if (ir == null || !reactRoll(s, ev, ir, "iron")) return false;
    spend(s, ir, "iron");
    ev.push({ type: "block", piece: ir, node: x.node, pieces: u.pieces.slice(), team, remote: true, back: u.node });
    return true;
  }
  // 순풍: 판 위의 우리 말이 모두 한 칸씩 (잡지 않음 — 상대가 바로 앞이면 그 말은 그대로. 풀숲·함정 안 걸림)
  function tailwind(s, ev, team) {
    const rem = x => x.atGoal ? 0 : remainingOf(x.route, x.step);
    unitsOf(s, team).sort((a, b) => rem(a) - rem(b)).forEach(x => {
      const d = stepMove(x, 1);
      if (!d || (!d.finish && piecesAt(s, d.node).some(j => s.pieces[j].team !== team))) return;
      const stack = d.finish ? [] : piecesAt(s, d.node).filter(j => x.pieces.indexOf(j) < 0);
      ev.push({ type: "move", team, result: 1, unit: "n" + x.node, pieces: x.pieces.slice(), path: d.path.slice(),
        from: { node: x.node, route: x.route, step: x.step, atGoal: !!x.atGoal }, to: d.finish ? null : { node: d.node, route: d.route, step: d.step, atGoal: d.atGoal },
        finish: d.finish, web: null, fly: false, back: false, skill: "tailwind" });
      if (d.finish) finishPieces(s, ev, x.pieces);
      else {
        x.pieces.forEach(i => Object.assign(s.pieces[i], { route: d.route, step: d.step, atGoal: d.atGoal }));
        unify(s, d.node, team, d);
        if (stack.length) ev.push({ type: "stack", node: d.node, pieces: x.pieces.concat(stack) });
      }
      x.pieces.forEach(i => { s.pieces[i].walk = (s.pieces[i].walk || 0) + 1; });
      evolveCheck(s, ev, x.pieces);
      if (d.finish) ev.push({ type: "finish", team, pieces: x.pieces.slice() });
    });
  }
  // 카운터가 되돌린 기술 — 기술을 쓴 말(과 그 팀)이 당한다. 되돌린 효과에는 또 반응하지 않는다
  function reflect(s, ev, i, key, byTeam) {
    const team = s.pieces[i].team, u = unitOfPiece(s, i);
    const open = u && !unitVeiled(s, u);
    if (key === "surf" && open) pushUnit(s, ev, u, 2, byTeam, key);
    else if (key === "quake") {
      const plans = unitsOf(s, team).filter(x => !unitVeiled(s, x));
      plans.forEach(x => pushUnit(s, ev, x, 1, byTeam, key));
    } else if (key === "discharge") discharge(s, ev, team, key);
    else if (key === "sleep" && open) setSleep(s, ev, u.pieces, key);
    else if (key === "icecharge" && open) freeze(s, ev, u.pieces, key);
    else if (key === "poisonjab" && open) setCount(s, ev, u.pieces, "weak", 2, key);
    else if (key === "kiss" && open) setCount(s, ev, u.pieces, "confuse", 1, key);
    else if (key === "stoneedge") { const x = leadFoe(s, byTeam); if (x) pushUnit(s, ev, x, 3, byTeam, key); }
    else if ((key === "flame" || key === "outrage") && open) {
      const node = u.node;
      u.pieces.forEach(j => sendHome(s, j));
      ev.push({ type: "home", pieces: u.pieces.slice(), node, team, skill: key });
    } else if (key === "toxic") { teamFx(s, team).poison = true; ev.push({ type: "status", kind: "poison", team, pieces: [], skill: key }); }
    else if (key === "spite") { teamFx(s, team).seal = untilFor(s, team, 3); ev.push({ type: "status", kind: "seal", team, pieces: [], skill: key }); }
    // 가로챈다·사이드체인지는 막기만 한다
  }
  function effect(s, ev, i, key, tg) {
    const p = s.pieces[i], team = p.team;
    const u = unitOfPiece(s, i);
    const foeAt = n => enemyUnits(s, team).find(x => x.node === n);
    // 🛡️ 철벽은 화염방사도 막는다
    if (key === "flame" && ironBlock(s, ev, team, u, foeAt(tg))) return;
    // 🥊 카운터 — 상대 팀에 준비된 카운터가 있으면 방해 기술을 되돌린다
    if (REFLECTABLE.indexOf(key) >= 0) {
      const vt = key === "snatch" ? s.pieces[tg].team : tg != null && foeAt(tg) ? s.pieces[foeAt(tg).pieces[0]].team : others(s, team)[0];
      const c = findReact(s, vt, "counter");
      if (c != null && reactRoll(s, ev, c, "counter")) {
        spend(s, c, "counter");
        ev.push({ type: "reflect", piece: c, key, team: vt, by: i });
        reflect(s, ev, i, key, vt);
        return;
      }
    }
    const opp = others(s, team);
    switch (key) {
      case "nitro": case "ddance": {
        const n = key === "nitro" ? 2 : 1;
        const d = planForward(s, team, u, n);
        doMove(s, ev, team, makeMove(s, team, n, -1, "n" + u.node, u.pieces, u, d), { skill: key });
        if (key === "ddance") { s.throwsLeft += 1; ev.push({ type: "again", team, skill: key }); }
        break;
      }
      case "fly": {
        const d = flyPlan(s, team, u);
        doMove(s, ev, team, makeMove(s, team, d.path.length, -1, "n" + u.node, u.pieces, u, d), { skill: key, fly: true });
        break;
      }
      case "uturn": {
        const d = backPlan(s, team, u, tg);
        s.pending.splice(s.pending.indexOf(tg), 1);
        doMove(s, ev, team, makeMove(s, team, tg, -1, "n" + u.node, u.pieces, u, d), { skill: key, back: true });
        break;
      }
      case "flame": {
        const x = foeAt(tg);
        captureAt(s, ev, team, u.pieces, x.pieces, tg, { remote: true, skill: key });
        ev.push({ type: "bonus", team });
        break;
      }
      case "surf": pushUnit(s, ev, foeAt(tg), 2, team, key); break;
      case "quake": {
        // 모두 한꺼번에 (원래 자리 기준) — 붙어 있던 말끼리 밀려서 엉키지 않게
        const plans = enemyUnits(s, team).filter(x => !unitVeiled(s, x));
        const evs = [];
        const moves = plans.map(x => { const tmp = []; pushUnit(clone(s), tmp, x, 1, team, key); return tmp[0]; });
        plans.forEach((x, k) => {
          const e = moves[k];
          if (e.path.length) {
            const nx = backSteps(x, 1)[0];
            x.pieces.forEach(j => Object.assign(s.pieces[j], { route: nx.route, step: nx.step, atGoal: false }));
            unify(s, nx.node, s.pieces[x.pieces[0]].team, nx);
          }
          evs.push(e);
        });
        evs.forEach(e => ev.push(e));
        break;
      }
      case "sleep": setSleep(s, ev, foeAt(tg).pieces, key); break;
      case "discharge": opp.forEach(t => discharge(s, ev, t, key)); break;
      case "wildcharge": {
        const d = planForward(s, team, u, 3);
        doMove(s, ev, team, makeMove(s, team, 3, -1, "n" + u.node, u.pieces, u, d), { skill: key });
        tire(s, ev, u.pieces, 1, key);
        break;
      }
      case "icecharge": freeze(s, ev, foeAt(tg).pieces, key); break;
      case "bulkup": setCount(s, ev, u.pieces, "bulk", 2, key); break;
      case "poisonjab": setCount(s, ev, foeAt(tg).pieces, "weak", 2, key); break;
      case "kiss": setCount(s, ev, foeAt(tg).pieces, "confuse", 1, key); break;
      case "dig":
        u.pieces.forEach(j => { const f = pfx(s.pieces[j]); f.dig = s.turnNo + s.teams.length - 1; f.digup = 1; }); // 상대 차례 한 번 + 다음 이동 +1
        ev.push({ type: "status", kind: "dig", pieces: u.pieces.slice(), node: u.node, team, skill: key });
        break;
      case "stoneedge": pushUnit(s, ev, leadFoe(s, team), 3, team, key); break;
      case "outrage": {
        const foes = outrageFoes(s, team, u);
        let hit = false;
        for (const x of foes) {
          if (u.pieces.some(j => s.pieces[j].state !== "board")) break; // 길동무로 같이 집에 갔으면 그만
          if (ironBlock(s, ev, team, u, x)) continue;
          captureAt(s, ev, team, u.pieces, x.pieces, x.node, { remote: true, skill: key });
          if (hit) s.throwsLeft -= 1; // 한 번 더는 한 번만
          hit = true;
        }
        if (hit) ev.push({ type: "bonus", team });
        tire(s, ev, u.pieces, 2, key);
        break;
      }
      case "magnet": {
        const v = unitsOf(s, team).find(x => x.node === tg);
        v.pieces.forEach(j => Object.assign(s.pieces[j], { route: u.route, step: u.step, atGoal: !!u.atGoal }));
        ev.push({ type: "magnet", team, pieces: v.pieces.slice(), from: v.node, to: u.node, all: u.pieces.concat(v.pieces) });
        break;
      }
      case "toxic": opp.forEach(t => { teamFx(s, t).poison = true; ev.push({ type: "status", kind: "poison", team: t, pieces: [], skill: key }); }); break;
      case "spite": opp.forEach(t => { teamFx(s, t).seal = untilFor(s, t, 3); ev.push({ type: "status", kind: "seal", team: t, pieces: [], skill: key }); }); break;
      case "snatch": {
        const q = s.pieces[tg], k2 = q.skill;
        q.used = true;
        if (s.__slot === "gift") p.gift = { key: k2, used: false };
        else { p.skill = k2; p.used = false; }
        ev.push({ type: "steal", piece: i, from: tg, key: k2, team });
        break;
      }
      case "veil": setStatus(s, ev, u.pieces, "veil", untilFor(s, opp[0], 2), key); break;
      case "rain":
        teamFx(s, team).rain = s.turnNo + s.teams.length * 2; // 이번 차례 포함 우리 차례 세 번
        ev.push({ type: "status", kind: "rain", team, pieces: [], skill: key });
        break;
      case "tailwind": tailwind(s, ev, team); break;
      case "allyswitch": { // v8: 우리 말 ↔ 상대 말 (잡기 없음, 업힌 말은 같이)
        const v = foeAt(tg);
        const a = { route: u.route, step: u.step, atGoal: !!u.atGoal }, b = { route: v.route, step: v.step, atGoal: !!v.atGoal };
        u.pieces.forEach(j => Object.assign(s.pieces[j], b));
        v.pieces.forEach(j => Object.assign(s.pieces[j], a));
        ev.push({ type: "switch", team, tb: s.pieces[v.pieces[0]].team, a: u.pieces.slice(), b: v.pieces.slice(), na: u.node, nb: v.node });
        break;
      }
      case "rock": case "web": case "spike":
        (s.traps = s.traps || []).push({ node: tg, kind: key, team });
        ev.push({ type: "trap", kind: key, node: tg, team });
        break;
      case "growth": {
        const r = s.pending[tg], nr = r === BACKDO ? 1 : Math.min(5, r + 1);
        s.pending[tg] = nr; // 기술로 만든 윷·모는 한 번 더 없음
        ev.push({ type: "grow", team, ri: tg, from: r, to: nr });
        break;
      }
      case "wish":
        s.pending.push(tg); // 던지기 한 번을 대신한다 — 윷·모를 골라도 한 번 더 없음
        s.throwsLeft -= 1;
        s.lastThrow = { result: tg, sticks: sticksFor(tg) };
        ev.push({ type: "wish", team, result: tg });
        break;
      case "future":
        s.guess = { team, r: tg };
        ev.push({ type: "guess", team, r: tg });
        break;
    }
  }
  function closeAction(s, ev) {
    if (s.phase !== "over" && teamDone(s, s.turn)) {
      s.phase = "over";
      s.winner = s.turn;
      s.pending = [];
      s.throwsLeft = 0;
      ev.push({ type: "win", team: s.turn });
      return { state: s, events: ev };
    }
    advance(s, ev);
    return { state: s, events: ev };
  }
  // 기술 쓰기 — 대상은 targetsFor 가 준 값 중 하나 (없는 기술은 null)
  function applySkill(state, i, target, slot) {
    const entry = legalSkills(state).find(x => x.piece === i && (!slot || x.slot === slot));
    if (!entry) throw new Error("Move not usable: " + i);
    const tg = target === undefined ? null : target;
    if (!entry.targets.some(x => x === tg)) throw new Error("Bad target: " + JSON.stringify(tg));
    const s = clone(state);
    const ev = [];
    const p = s.pieces[i], key0 = entry.key;
    s.skillTurn = s.turnNo; // 한 차례에 기술 하나
    // 🎲 발동 확률 (v8) — 실패해도 기술은 쓴 것으로 사라진다 (사용자 확정 2026-09-29)
    const ch = skillChance(s, i, key0, tg);
    const ok = ch.chance >= 1 || srand(s) < ch.chance;
    if (entry.slot === "gift") p.gift.used = true; else p.used = true;
    ev.push({ type: "skill", piece: i, key: key0, team: p.team, target: tg, slot: entry.slot, chance: ch.chance, match: ch.match, ok });
    if (!ok) {
      ev.push({ type: "skillfail", piece: i, key: key0, team: p.team, chance: ch.chance });
      return closeAction(s, ev);
    }
    s.__slot = entry.slot;   // 가로챈다: 빼앗은 기술을 같은 칸에 (아래에서 지움)
    if (key0 === "metronome") {
      const pool = metroPool(s, i);
      const key = pool[Math.floor(srand(s) * pool.length)];
      const t2 = bestTarget(s, i, key);
      ev.push({ type: "metronome", piece: i, key, target: t2, team: p.team });
      effect(s, ev, i, key, t2);
    } else effect(s, ev, i, key0, tg);
    delete s.__slot;
    return closeAction(s, ev);
  }

  /* ---------- v3: 말 바꾸기 — ❓ 풀숲에서 잡은 포켓몬을 그 자리에 ----------
   * o: { id, path(1단계부터 끝까지), base(path 안에서 잡은 모습의 단계), pool, early }
   * 바뀐 말이 간 칸 수를 이어받아 곧바로 진화한다. 기술은 새로 배운다 */
  function swapOk(s, i, root) {
    const p = s.pieces[i];
    if (!p || p.state === "done") return false;
    return !s.teams.some((t, ti) => t.paths.some((pp, k) => !(ti === p.team && k === p.slot) && pp[0] === root));
  }
  function applySwap(state, i, o) {
    if (!o || !Array.isArray(o.path) || !o.path.length || o.path.indexOf(o.id) < 0) throw new Error("Bad swap Pokémon");
    if (!swapOk(state, i, o.path[0])) throw new Error("Cannot swap this piece (already home, or same family in play): " + i);
    const s = clone(state);
    const ev = [];
    const p = s.pieces[i], t = s.teams[p.team];
    const from = formOf(s, i);
    t.picks[p.slot] = o.id;
    t.paths[p.slot] = o.path.slice();
    (t.pools = t.pools || [])[p.slot] = (o.pool || []).slice();
    (t.early = t.early || [])[p.slot] = !!o.early;
    if (t.now) t.now[p.slot] = false;
    if (o.need != null) (t.need = t.need || s.teams[p.team].paths.map(() => 0))[p.slot] = o.need;
    if (o.rar) (t.rar = t.rar || t.paths.map(() => "c"))[p.slot] = o.rar;
    if (Array.isArray(o.types)) (t.types = t.types || t.paths.map(() => null))[p.slot] = o.types;
    const base = o.base != null ? o.base : o.path.indexOf(o.id);
    Object.assign(p, { base, stage: base, skill: null, used: false, fx: {} });
    if (p.state !== "board") p.walk = 0;
    ev.push({ type: "swap", piece: i, from, to: o.id, team: p.team });
    evolveCheck(s, ev, [i]);
    return { state: s, events: ev };
  }
  // 로켓단이 잡은 포켓몬을 넣을 말: 기술을 다 쓴 말 → 집에 있는 말 → (prefer) 멈춘 말
  function cpuSwapTarget(s, team, root, prefer) {
    const cand = s.pieces.map((p, i) => i).filter(i => s.pieces[i].team === team && swapOk(s, i, root));
    if (!cand.length) return null;
    const used = cand.find(i => s.pieces[i].state === "board" && s.pieces[i].skill && s.pieces[i].used);
    if (used != null) return used;
    const wait = cand.find(i => s.pieces[i].state === "wait");
    if (wait != null) return wait;
    return cand.indexOf(prefer) >= 0 ? prefer : cand[0];
  }

  /* ---------- 판 만들기·던지기·두기 ---------- */
  function newGame(o, evoFrom) {
    const n = o.pieces || 4;
    const seed = (o.seed >>> 0) || 1;
    const s = {
      v: 2,
      seed,
      rng: seed,
      srng: ((seed ^ 0x5ca1ab1e) >>> 0) || 1, // 기술 뽑기 난수 — 윷 던지기 흐름과 따로
      settings: { pieces: n, backdo: o.backdo !== false, mode: o.mode || "family", cpuLevel: o.cpuLevel || "normal", battle: o.battle !== false, skills: o.skills !== false }, // battle: 배틀 장면 보기 (화면 쪽 설정)
      teams: o.teams.map(t => ({
        name: t.name, color: t.color, cpu: !!t.cpu, key: t.key || null, avatar: Number(t.avatar) || null, // 👤 팀 캐릭터 포켓몬 (화면 표시용)
        picks: t.picks.slice(0, n),
        // 진화 경로: 화면 쪽이 정해 넘기면 그대로 (사람 팀은 마지막 모습까지), 없으면 고른 모습까지
        paths: Array.isArray(t.paths) && t.paths.length >= n ? t.paths.slice(0, n) : t.picks.slice(0, n).map(id => evoPath(id, evoFrom)),
        // 기술 후보(말마다) — 화면 쪽이 타입을 보고 정해 넘긴다 (엔진은 포켓몬 데이터를 모른다)
        pools: Array.from({ length: n }, (_, k) => (Array.isArray(t.pools) && Array.isArray(t.pools[k]) ? t.pools[k].filter(x => SKILLS[x]) : [])),
        early: Array.from({ length: n }, (_, k) => !!(Array.isArray(t.early) && t.early[k])), // 전설: 15칸 가야 기술 (v4)
        now: Array.from({ length: n }, (_, k) => !!(Array.isArray(t.now) && t.now[k])),       // 시험용: 처음부터 기술
        need: Array.isArray(t.need) ? Array.from({ length: n }, (_, k) => Number(t.need[k]) || 0) : undefined, // v5: 기술까지 필요한 칸
        bases: Array.isArray(t.bases) ? Array.from({ length: n }, (_, k) => Math.max(0, Number(t.bases[k]) || 0)) : undefined, // v6: 처음 모습 (진화형을 잡았으면 그 모습부터)
        rar: Array.isArray(t.rar) ? Array.from({ length: n }, (_, k) => CHANCE[t.rar[k]] ? t.rar[k] : "c") : undefined,       // v8: 기술 발동 확률의 희귀도
        types: Array.isArray(t.types) ? Array.from({ length: n }, (_, k) => Array.isArray(t.types[k]) ? t.types[k] : null) : undefined, // v8: 상성 (말마다 단계별 타입)
        fx: {},
      })),
      pieces: [],
      turn: o.first || 0,
      phase: "throw",
      pending: [],
      throwsLeft: 1,
      turnNo: 1,
      winner: null,
      lastThrow: null,
      // ❓ 풀숲 칸 — 어느 칸·어떤 포켓몬인지는 화면 쪽이 정해서 넘긴다 (엔진은 포켓몬 데이터를 모른다)
      spots: (o.spots || []).map(sp => ({ node: sp.node, id: sp.id, used: false })),
      traps: [],
      skillTurn: 0,
      guess: null,
      k8: true,
    };
    s.teams.forEach((t, ti) => {
      for (let k = 0; k < n; k++) {
        const b = Math.min(t.bases ? t.bases[k] : 0, t.paths[k].length - 1); // 리자드를 잡아 골랐으면 리자드부터 (잡히면 리자드로 돌아감)
        s.pieces.push({ team: ti, slot: k, state: "wait", route: "OUT", step: 0, atGoal: false, stage: b, walk: 0, base: b, skill: null, used: false, fx: {} });
      }
    });
    s.pieces.forEach((_, i) => learn(s, null, i)); // 시험용(now)만 처음부터
    return s;
  }

  function teamDone(s, t) { return s.pieces.every(p => p.team !== t || p.state === "done"); }

  function endTurn(s, ev) {
    s.turn = (s.turn + 1) % s.teams.length;
    s.phase = "throw";
    s.throwsLeft = 1;
    s.pending = [];
    s.turnNo++;
    s.guess = null;
    // 끝난 효과는 치운다 (화면 표시가 깔끔하게)
    s.pieces.forEach(p => { const f = p.fx; if (f) BLOCKS.concat(["veil", "dig"]).forEach(k => { if (f[k] && f[k] < s.turnNo) { delete f[k]; delete f[k + "From"]; } }); });
    s.teams.forEach(t => { const f = t.fx; if (f) ["seal", "rain", "chill"].forEach(k => { if (f[k] && f[k] < s.turnNo) delete f[k]; }); });
    ev.push({ type: "turn", team: s.turn });
    wakeCheck(s, ev);
  }
  // 💤 차례가 시작될 때 잠든 말이 깰까? 첫 번째 차례 20% · 두 번째 50% (사용자 확정 2026-09-28)
  function wakeCheck(s, ev) {
    unitsOf(s, s.turn).forEach(u => {
      const sl = u.pieces.filter(i => blockOn(s, fxP(s.pieces[i]), "sleep"));
      if (!sl.length) return;
      const f = fxP(s.pieces[sl[0]]);
      const chance = s.turnNo >= f.sleep ? 0.5 : 0.2;
      const ok = srand(s) < chance;
      if (ok) sl.forEach(i => { delete s.pieces[i].fx.sleep; delete s.pieces[i].fx.sleepFrom; });
      ev.push({ type: "wake", team: s.turn, pieces: sl, node: u.node, ok, chance });
    });
  }
  // 던지기·두기가 끝난 뒤 다음 단계 정하기
  function advance(s, ev) {
    if (s.throwsLeft > 0) { s.phase = "throw"; return; }
    if (s.pending.length) {
      s.phase = "choose";
      if (legalMoves(s).length) return;
      ev.push({ type: "skip", team: s.turn, results: s.pending.slice() }); // 쓸 수 있는 결과가 없음 → 쉬어 가요
      s.pending = [];
    }
    endTurn(s, ev);
  }

  function applyThrow(state, forced) {
    if (state.phase !== "throw") throw new Error("Not time to throw: " + state.phase);
    const s = clone(state);
    const ev = [];
    let t;
    if (forced != null && RESULTS[forced] && (forced !== BACKDO || s.settings.backdo)) {
      t = { result: forced, sticks: sticksFor(forced) };
    } else {
      t = throwSticks(s.rng, s.settings.backdo);
      s.rng = t.rng;
    }
    let res = t.result, poisoned = false, rained = null, chilled = null;
    const tf = teamFx(s, s.turn);
    if (tf.poison) { tf.poison = false; poisoned = true; res = s.settings.backdo ? BACKDO : 1; } // ☠️ 맹독: 다음 윷이 빽도 (빽도를 끈 판이면 도)
    if (isRaining(s, s.turn) && (res === 1 || res === BACKDO)) { rained = res; res = 2; }       // 🌧️ 비: 도·빽도 → 개
    if (tf.chill === s.turnNo && res >= 3) { chilled = res; res = 2; }                           // 🧊 아이스차징: 걸·윷·모 → 개
    const sticks = res === t.result ? t.sticks : sticksFor(res);
    s.pending.push(res);
    s.throwsLeft -= 1;
    if (RESULTS[res].again) s.throwsLeft += 1;
    s.lastThrow = { result: res, sticks };
    ev.push({ type: "throw", team: s.turn, result: res, sticks, again: RESULTS[res].again, poisoned, rained, chilled });
    // 🔮 미래예지: 맞히면 한 번 더
    if (s.guess && s.guess.team === s.turn) {
      const ok = s.guess.r === res;
      if (ok) s.throwsLeft += 1;
      ev.push({ type: "foresee", team: s.turn, guess: s.guess.r, result: res, ok });
      s.guess = null;
    }
    advance(s, ev);
    return { state: s, events: ev };
  }

  // pick: 새 말을 낼 때 대기 중인 말 중 어느 포켓몬을 낼지 (없으면 첫 번째)
  /* 🎁 골인한 말이 못 쓴 기술(제 기술·받은 기술)을 팀원에게 — 사람 팀은 고르게 줄에 세우고(gifts), 로켓단은 바로 준다 */
  function giftTargets(s, team) {
    return s.pieces.map((p, i) => i).filter(i => s.pieces[i].team === team && s.pieces[i].state !== "done" && !giftReady(s.pieces[i]));
  }
  function autoGiftTarget(s, team) {
    const c = giftTargets(s, team);
    const noSkill = i => !ownReady(s, i) && !(s.pieces[i].skill && !s.pieces[i].used);
    return c.find(i => s.pieces[i].state === "board" && noSkill(i)) ?? c.find(i => s.pieces[i].state === "board") ?? c.find(noSkill) ?? c[0] ?? null;
  }
  function passSkills(s, ev, i) {
    const p = s.pieces[i], team = p.team;
    if (s.settings.skills === false) return;
    const keys = [];
    if (p.skill && !p.used) { keys.push(p.skill); p.used = true; }
    if (giftReady(p)) { keys.push(p.gift.key); p.gift.used = true; }
    keys.forEach(key => {
      if (!giftTargets(s, team).length) return; // 남은 팀원이 없거나(이김) 모두 받은 기술을 들고 있음
      if (s.teams[team].cpu) {
        const to = autoGiftTarget(s, team);
        s.pieces[to].gift = { key, used: false };
        ev.push({ type: "gift", team, from: i, to, key });
      } else {
        (s.gifts = s.gifts || []).push({ team, from: i, key });
        ev.push({ type: "giftask", team, from: i, key });
      }
    });
  }
  // 줄의 맨 앞 기술을 팀원 to 에게 (to 가 없으면 알아서 고른다)
  function applyGift(state, to) {
    const s = clone(state), ev = [];
    const q = (s.gifts || [])[0];
    if (!q) throw new Error("No gift move waiting");
    const cand = giftTargets(s, q.team);
    if (to == null) to = autoGiftTarget(s, q.team);
    if (cand.indexOf(to) < 0) throw new Error("This piece cannot take the gift: " + to);
    s.pieces[to].gift = { key: q.key, used: false };
    s.gifts.shift();
    ev.push({ type: "gift", team: q.team, from: q.from, to, key: q.key });
    // 다음 줄 기술을 받을 팀원이 없으면 버린다
    while (s.gifts.length && !giftTargets(s, s.gifts[0].team).length) ev.push(Object.assign({ type: "giftlost" }, s.gifts.shift()));
    return { state: s, events: ev };
  }

  function applyMove(state, moveId, pick) {
    const m = legalMoves(state).find(x => x.id === moveId);
    if (!m) throw new Error("Illegal move: " + moveId);
    if (m.unit === "new" && pick != null && waitingOf(state, state.turn).indexOf(pick) >= 0) m.pieces = [pick];
    const s = clone(state);
    const ev = [];
    s.pending.splice(m.ri, 1);
    if (m.confused) ev.push({ type: "confused", team: s.turn, pieces: m.pieces.slice(), node: m.from.node });
    const mod = m.result > 0 && m.unit !== "new" ? m.pieces.slice() : [];
    doMove(s, ev, s.turn, m, m.confused ? { back: true } : {});
    // 앞으로 간 한 번 = 횟수 효과 하나씩 (빽도는 그대로)
    mod.forEach(i => {
      const f = s.pieces[i].fx;
      if (!f) return;
      ["bulk", "weak", "digup"].forEach(k => { if (f[k] > 0) { f[k]--; if (!f[k]) delete f[k]; } });
      if (m.confused) delete f.confuse;
    });
    return closeAction(s, ev);
  }

  /* ---------- 로켓단(컴퓨터) ---------- */
  const remainingOf = (route, step) => ROUTES[route].length - 1 - step;
  function gainOf(m) {
    const before = m.unit === "new" ? 20 : m.from.atGoal ? 1 : remainingOf(m.from.route, m.from.step);
    const after = m.finish ? 0 : m.to.atGoal ? 1 : remainingOf(m.to.route, m.to.step);
    return before - after;
  }
  // 다음 차례에 상대가 이 칸에 올 수 있는 확률 (대충)
  function threat(state, node, team) {
    if (node == null || node < 0) return 0;
    const P = resultProbs(state.settings.backdo);
    let total = 0;
    Object.keys(P).forEach(k => {
      const r = Number(k);
      let hit = false;
      state.teams.forEach((_, o) => {
        if (hit || o === team) return;
        unitsOf(state, o).forEach(u => {
          const d = stepMove(u, r);
          if (d && !d.finish && d.node === node) hit = true;
        });
        if (!hit && r > 0 && waitingOf(state, o).length && r === node) hit = true; // 새 말이 들어오는 칸
      });
      if (hit) total += P[r];
    });
    return Math.min(1, total);
  }
  function cpuScore(state, m, level) {
    const team = state.turn;
    const n = m.pieces.length;
    let v = 100 * m.capture.length + gainOf(m);
    if (m.finish) v += 60 * n;
    else {
      if (!m.to.atGoal && (m.to.node === 5 || m.to.node === 10 || m.to.node === 22)) v += 40;
      v += 25 * m.stack.length;
      if (state.spots && state.spots.some(sp => !sp.used && sp.node === m.to.node)) v += 15; // ❓ 풀숲을 먼저 밟기
      if (m.rock) v -= 90 * n;                                                               // 🪨 상대 바위는 피하기
      if (m.spike) v -= 30 * n;                                                              // 🟣 독압정도
      if (level !== "easy") v -= 120 * threat(state, m.to.node, team) * (n + m.stack.length);
    }
    if (level !== "easy" && m.unit !== "new") v += 80 * threat(state, m.from.node, team) * n; // 위험한 칸에서 피하기
    return v;
  }
  // 난이도 = 아무 수나 두는 비율. 아이가 상대라서 약하게 맞췄다 (tools/sim-cpu.js 로 확인)
  //   쉬움 1.0 → 아무렇게나 두는 상대와 반반 · 보통 0.5 → 약 73% 승 · 어려움 0 → 약 84% 승 (화면엔 없음, 시험용)
  const CPU_RANDOM = { easy: 1, normal: 0.5, hard: 0 };
  function cpuChoose(state, level, rnd) {
    rnd = rnd || Math.random;
    const ms = legalMoves(state);
    if (!ms.length) return null;
    const pr = CPU_RANDOM[level] == null ? 0.5 : CPU_RANDOM[level];
    if (pr >= 1 || rnd() < pr) return ms[Math.floor(rnd() * ms.length)];
    let best = -Infinity, pick = [];
    ms.forEach(m => {
      const v = cpuScore(state, m, "hard");
      if (v > best + 1e-9) { best = v; pick = [m]; }
      else if (Math.abs(v - best) <= 1e-9) pick.push(m);
    });
    return pick[Math.floor(rnd() * pick.length)];
  }
  // 기술의 쓸모 (로켓단이 고를 때, 손가락흔들기가 대상을 고를 때)
  function scoreSkill(s, i, key, tg) {
    const p = s.pieces[i], team = p.team, u = unitOfPiece(s, i);
    if (!u) return -999;
    const rem = x => x.atGoal ? 1 : remainingOf(x.route, x.step);
    const foeAt = n => enemyUnits(s, team).find(x => x.node === n);
    const moveValue = d => {
      if (!d) return -999;
      if (d.finish) return 70 * u.pieces.length;
      let v = (rem(u) - (d.atGoal ? 1 : remainingOf(d.route, d.step))) * 3;
      v += 100 * piecesAt(s, d.node).filter(j => s.pieces[j].team !== team).length;
      if (d.node === 5 || d.node === 10 || d.node === 22) v += 20;
      if (activeTrap(s, team, d.node, "rock")) v -= 150;
      if (activeTrap(s, team, d.node, "spike")) v -= 30;
      return v;
    };
    const trapValue = node => {
      const P = resultProbs(s.settings.backdo);
      let v = 0;
      enemyUnits(s, team).forEach(x => [1, 2, 3, 4, 5].forEach(r => { const d = stepMove(x, r); if (d && !d.finish && d.node === node) v += P[r]; }));
      others(s, team).forEach(t => { if (waitingOf(s, t).length && node >= 1 && node <= 5) v += P[node] * 0.5; });
      return 5 + v * (key === "rock" ? 70 : key === "spike" ? 50 : 45);
    };
    switch (key) {
      case "nitro": return 8 + moveValue(planForward(s, team, u, 2));
      case "ddance": return 25 + moveValue(planForward(s, team, u, 1));
      case "fly": return moveValue(flyPlan(s, team, u));
      case "uturn": { const d = backPlan(s, team, u, tg); return d && piecesAt(s, d.node).some(j => s.pieces[j].team !== team) ? 110 : -5; }
      case "flame": { const x = foeAt(tg); return 110 + (20 - rem(x)); }
      case "surf": { const x = foeAt(tg); return 10 + (20 - rem(x)) + 6 * x.pieces.length; }
      case "quake": return 9 * enemyUnits(s, team).filter(x => !unitVeiled(s, x) && canPushBack(s, x)).reduce((t, x) => t + x.pieces.length, 0);
      case "discharge": return 4 + 7 * enemyUnits(s, team).filter(x => !unitVeiled(s, x) && !unitBlocked(s, x)).reduce((t, x) => t + x.pieces.length, 0);
      case "wildcharge": return moveValue(planForward(s, team, u, 3)) - 4;
      case "icecharge": { const x = foeAt(tg); return 14 + (20 - rem(x)) + 4 * x.pieces.length; }
      case "bulkup": return 14;
      case "poisonjab": { const x = foeAt(tg); return 8 + Math.round((20 - rem(x)) / 2) + 3 * x.pieces.length; }
      case "kiss": { const x = foeAt(tg); return 10 + (20 - rem(x)) + 3 * x.pieces.length; }
      case "dig": return threat(s, u.node, team) > 0.25 ? 32 : 5;
      case "stoneedge": { const x = leadFoe(s, team); return x ? 12 + (20 - rem(x)) + 4 * x.pieces.length : -999; }
      case "outrage": return 100 * outrageFoes(s, team, u).reduce((t, x) => t + x.pieces.length, 0) - 15;
      case "magnet": { const v = unitsOf(s, team).find(x => x.node === tg); return v ? 3 * (rem(v) - rem(u)) * v.pieces.length + 4 : -999; }
      case "sleep": { const x = foeAt(tg); return 12 + (20 - rem(x)) + 5 * x.pieces.length; }
      case "toxic": return 22;
      case "spite": return s.pieces.some(q => q.team !== team && q.skill && !q.used) ? 30 : 6;
      case "snatch": return 40;
      case "rock": case "web": case "spike": return trapValue(tg);
      case "veil": return threat(s, u.node, team) > 0.25 ? 35 : 4;
      case "rain": return 16;
      case "tailwind": return 6 * unitsOf(s, team).length;
      case "allyswitch": { const x = foeAt(tg); const g = rem(u) - rem(x); return g > 2 ? 6 + 4 * g * u.pieces.length : -5; }
      case "growth": return 12;
      case "wish": return 10 + 3 * tg;
      case "future": return tg === 2 || tg === 3 ? 14 : 2;
      case "metronome": return 18;
    }
    return 0;
  }
  function bestTarget(s, i, key) {
    const tg = targetsFor(s, i, key);
    let best = tg[0], bv = -Infinity;
    tg.forEach(t => { const v = scoreSkill(s, i, key, t); if (v > bv) { bv = v; best = t; } });
    return best;
  }
  // 로켓단 기술: 쉬움은 방해 기술을 안 쓰고 가끔만 (30%), 보통은 쓸모 있을 때 (가끔은 아낀다)
  function cpuSkill(state, level, rnd) {
    rnd = rnd || Math.random;
    const list = legalSkills(state);
    if (!list.length) return null;
    const cand = [];
    list.forEach(x => {
      const cat = SKILLS[x.key].cat;
      if (level === "easy" && (cat === "attack" || cat === "trap" || cat === "random")) return;
      x.targets.forEach(tg => {
        const v = scoreSkill(state, x.piece, x.key, tg);
        cand.push({ piece: x.piece, key: x.key, slot: x.slot, target: tg, v: v > 0 ? v * skillChance(state, x.piece, x.key, tg).chance : v }); // 🎲 잘 안 나올 기술은 덜 좋게
      });
    });
    if (!cand.length) return null;
    cand.sort((a, b) => b.v - a.v);
    const best = cand[0];
    if (level === "easy") return rnd() < 0.3 && best.v > 0 ? best : null;
    if (best.v < (level === "hard" ? 8 : 15)) return null; // 💀 어려움: 쓸모가 조금만 있어도 쓰고, 아끼지 않는다
    if (level === "normal" && rnd() < 0.25) return null;
    return best;
  }

  /* ---------- 저장본 검사 (망가진 판은 버린다) ---------- */
  function validate(s) {
    try {
      if (!s || s.v !== 2 || !Array.isArray(s.teams) || s.teams.length < 2 || !Array.isArray(s.pieces)) return false;
      if (["throw", "choose", "over"].indexOf(s.phase) < 0 || !Array.isArray(s.pending)) return false;
      if (s.pieces.length !== s.teams.length * s.settings.pieces) return false;
      if (s.teams.some(t => !Array.isArray(t.paths) || t.paths.length !== s.settings.pieces || t.paths.some(p => !p.length))) return false;
      if (s.teams.some(t => !Array.isArray(t.pools) || !Array.isArray(t.early) || t.pools.some(p => !Array.isArray(p) || p.some(k => !SKILLS[k])))) return false;
      if (s.spots != null && (!Array.isArray(s.spots) || s.spots.some(sp =>
        !sp || !NODES[sp.node] || !(sp.id == null || (sp.id >= 1 && sp.id <= 1025)) || typeof sp.used !== "boolean"))) return false;
      if (!Array.isArray(s.traps) || s.traps.some(t => !t || !(t.node >= 1 && t.node < NODES.length) || ["rock", "web", "spike"].indexOf(t.kind) < 0 || !s.teams[t.team])) return false;
      return s.pieces.every(p =>
        ["wait", "board", "done"].indexOf(p.state) >= 0 && ROUTES[p.route] &&
        p.step >= 0 && p.step < ROUTES[p.route].length && p.team >= 0 && p.team < s.teams.length &&
        p.walk >= 0 && p.base >= 0 && p.base < s.teams[p.team].paths[p.slot].length && p.stage >= 0 &&
        (p.skill == null || !!SKILLS[p.skill]) && typeof p.used === "boolean" && p.fx && typeof p.fx === "object" &&
        (p.gift == null || (!!SKILLS[p.gift.key] && typeof p.gift.used === "boolean"))) &&
        (s.gifts == null || (Array.isArray(s.gifts) && s.gifts.every(g => g && s.teams[g.team] && SKILLS[g.key]))) &&
        s.pending.every(r => RESULTS[r]);
    } catch (e) { return false; }
  }
  // 옛 저장(v1, 기술 전)을 v2 로 — 옛 판은 기술 없이 그대로 이어 한다
  function upgrade(s) {
    if (s && typeof s === "object" && s.v === 2) return migrate8(s);
    if (!s || typeof s !== "object" || s.v !== 1 || !Array.isArray(s.teams) || !Array.isArray(s.pieces)) return s;
    const u = clone(s);
    u.v = 2;
    u.settings = Object.assign({}, u.settings, { skills: false });
    u.srng = ((u.seed ^ 0x5ca1ab1e) >>> 0) || 1;
    u.teams.forEach(t => {
      const n = (t.paths || []).length;
      t.pools = Array.from({ length: n }, () => []);
      t.early = Array.from({ length: n }, () => false);
      t.fx = {};
    });
    u.pieces.forEach(p => Object.assign(p, { walk: p.state === "board" && !p.atGoal ? p.step : 0, base: 0, skill: null, used: false, fx: {} }));
    u.traps = [];
    u.skillTurn = 0;
    u.guess = null;
    return u;
  }
  // v8 (2026-09-28): 흑안개 → 아이스차징 · 전기자석파 → 방전, 기술까지 칸은 모두 10칸
  function migrate8(s) {
    if (!Array.isArray(s.teams) || !Array.isArray(s.pieces) || s.k8) return s;
    const u = clone(s);
    const ren = k => RENAMED[k] || k;
    u.teams.forEach(t => {
      if (Array.isArray(t.pools)) t.pools = t.pools.map(p => Array.isArray(p) ? Array.from(new Set(p.map(ren))) : p);
      if (Array.isArray(t.need)) t.need = t.need.map(() => 10);
    });
    u.pieces.forEach(p => {
      if (p.skill) p.skill = ren(p.skill);
      if (p.gift && p.gift.key) p.gift.key = ren(p.gift.key);
    });
    if (Array.isArray(u.gifts)) u.gifts.forEach(g => { if (g) g.key = ren(g.key); });
    u.k8 = true;
    return u;
  }

  /* ---------- ❓ 풀숲 칸 고르기 ----------
   * 바깥 길의 보통 칸 중에서 (출발 바로 옆 1·2번, 모서리·방·참먹이, 들어가기 어려운 대각선은 뺀다)
   * 두 칸이 서로 붙지 않게 */
  const SPOT_NODES = [3, 4, 6, 7, 8, 9, 11, 12, 13, 14, 16, 17, 18, 19];
  const neighbors = {};
  LINES.forEach(l => l.forEach((n, i) => {
    if (i > 0) { (neighbors[n] = neighbors[n] || []).push(l[i - 1]); (neighbors[l[i - 1]] = neighbors[l[i - 1]] || []).push(n); }
  }));
  function pickSpotNodes(rnd, count) {
    const out = [];
    for (let tries = 0; out.length < (count || 2) && tries < 200; tries++) {
      const n = SPOT_NODES[Math.floor(rnd() * SPOT_NODES.length)];
      if (out.indexOf(n) >= 0 || out.some(o => (neighbors[o] || []).indexOf(n) >= 0)) continue;
      out.push(n);
    }
    return out;
  }
  // 화면 쪽에서 쓰는 시드 난수 함수 (판 흐름과 따로)
  function rng(seed) {
    let st = (seed >>> 0) || 1;
    return () => { const r = rand(st); st = r[1]; return r[0]; };
  }

  /* ---------- 보물상자·볼·야생 포켓몬 확률 (v2) ----------
   * 볼 5단계: 상자에서 50·30·10·5·5, 잡을 확률 60% + 단계마다 5% (마스터볼만 원작처럼 100%) */
  const BALLS = ["poke", "great", "ultra", "luxury", "master"];
  const BALL_INFO = {
    poke: { name: "Poké Ball", img: "poke-ball", odds: 50 },
    great: { name: "Great Ball", img: "great-ball", odds: 30 },
    ultra: { name: "Ultra Ball", img: "ultra-ball", odds: 10 },
    luxury: { name: "Luxury Ball", img: "luxury-ball", odds: 5 },
    master: { name: "Master Ball", img: "master-ball", odds: 5 },
  };
  const WILD_ODDS = { c: 50, r: 30, u: 10, l: 10 }; // ❓ 풀숲에서 나오는 희귀도 (사용자 확정 2026-09-25)
  const WILD_ODDS_BOOST = { c: 30, r: 30, u: 20, l: 20 }; // 🕐 시계 문제를 맞히면 그 조우만 (사용자 확정 2026-09-26: 유니크·전설 +10, 일반 −20)
  const Rewards = {
    BALLS, BALL_INFO, WILD_ODDS, WILD_ODDS_BOOST, BOX_SIZE: 3, THROWS: 3, UNOWNED_FIRST: 0.5,
    // 💀 어려움을 이기면 (사용자 확정 2026-09-28): 볼 4개 + 좋은 볼이 더 잘 나온다
    BOX_SIZE_HARD: 4, BOX_ODDS_HARD: { poke: 25, great: 30, ultra: 25, luxury: 10, master: 10 },
    // 잡을 확률 (사용자 확정 2026-09-29, 전에는 60·50·40·30): 몬스터볼 기준 일반 80 · 레어 70 · 유니크 60 · 전설 40%,
    // 볼이 한 단계 좋을 때마다 +5%, 이번 조우에서 놓칠 때마다 +10% (최대 100%). 마스터볼은 늘 100%
    CATCH_BASE: { c: 0.8, r: 0.7, u: 0.6, l: 0.4 }, FAIL_BONUS: 0.1,
    catchRate(ball, rarity, fails) {
      if (ball === "master") return 1;
      const base = Rewards.CATCH_BASE[rarity] != null ? Rewards.CATCH_BASE[rarity] : Rewards.CATCH_BASE.c;
      return Math.min(1, Math.round((base + 0.05 * Math.max(0, BALLS.indexOf(ball)) + Rewards.FAIL_BONUS * (fails || 0)) * 100) / 100);
    },
    // 상자 하나 = 볼 n개, 한 개씩 따로 뽑는다
    rollBox(n, rnd, odds) {
      const W = odds || BALLS.reduce((o, b) => (o[b] = BALL_INFO[b].odds, o), {});
      const total = BALLS.reduce((t, b) => t + (W[b] || 0), 0);
      const out = [];
      for (let i = 0; i < n; i++) {
        let x = rnd() * total;
        const b = BALLS.find(k => (x -= (W[k] || 0)) < 0) || "poke";
        out.push(b);
      }
      return out;
    },
    // 던지기: 결과를 먼저 뽑고 흔드는 횟수를 맞춘다 (성공 3번, 실패 1~3번)
    throwBall(ball, rnd, rarity, fails) {
      const ok = rnd() < Rewards.catchRate(ball, rarity, fails);
      return { ok, shakes: ok ? 3 : 1 + Math.floor(rnd() * 3) };
    },
    // 야생 포켓몬: 희귀도 50·30·10·10 → 절반은 아직 없는 포켓몬 먼저. pools = { c:[ids], r:[...], u:[...], l:[...] }
    rollWild(pools, owned, rnd, odds) {
      const W = odds || WILD_ODDS;
      const has = owned instanceof Set ? owned : new Set(owned || []);
      const keys = Object.keys(W).filter(k => pools[k] && pools[k].length);
      const total = keys.reduce((t, k) => t + W[k], 0);
      let x = rnd() * total;
      const k = keys.find(q => (x -= W[q]) < 0) || keys[0];
      let pool = pools[k];
      const fresh = pool.filter(id => !has.has(id));
      if (fresh.length && rnd() < Rewards.UNOWNED_FIRST) pool = fresh;
      return pool[Math.floor(rnd() * pool.length)];
    },
  };

  /* ---------- v4: 🎓 공부 문제 — 🕐 시계 보기 · 💰 돈 세기 (순수 함수) ----------
   * 보기 4개 중 오답은 아이가 실제로 하는 실수로 만든다 */
  const Study = {
    LEVELS: 3,
    // 어려움 자동 오르내림: 3번 연속 맞히면 위, 2번 연속 틀리면 아래
    record(st, ok) {
      const o = Object.assign({ level: 1, up: 0, down: 0, right: 0, total: 0 }, st || {});
      o.total++;
      if (ok) { o.right++; o.up++; o.down = 0; if (o.up >= 3 && o.level < Study.LEVELS) { o.level++; o.up = 0; } }
      else { o.down++; o.up = 0; if (o.down >= 2 && o.level > 1) { o.level--; o.down = 0; } }
      return o;
    },
    /* 시계: level 1 = 정각·30분 · 2 = 5분 단위 · 3 = 1분 단위 → { h, m, choices: [{h, m}], answer } */
    clock(level, rnd, forced) {
      const pick = a => a[Math.floor(rnd() * a.length)];
      let h = 1 + Math.floor(rnd() * 12), m;
      if (level <= 1) m = pick([0, 30]);
      else if (level === 2) m = 5 * Math.floor(rnd() * 12);
      else { do { m = Math.floor(rnd() * 60); } while (m % 5 === 0); }
      if (forced) { h = forced.h; m = forced.m; }
      const H = x => ((x - 1 + 1200) % 12) + 1;
      const key = c => c.h + ":" + c.m;
      const out = [{ h, m }], seen = {};
      seen[key({ h, m })] = 1;
      const add = c => { if (c && c.m >= 0 && c.m < 60 && !seen[key(c)] && out.length < 4) { seen[key(c)] = 1; out.push(c); } };
      const k = Math.round(m / 5) % 12;                    // 분침이 가리키는(가까운) 숫자
      add(m > 0 ? { h: H(h + 1), m } : { h: H(h - 1), m }); // 시침이 숫자 사이에 있으면 다음 숫자로 읽는 실수
      add({ h: k === 0 ? 12 : k, m: (h % 12) * 5 });        // 두 바늘을 바꿔 읽는 실수
      if (m % 5 === 0 && m > 0) add({ h, m: m / 5 });       // 분침 숫자를 그대로 "분"으로 읽는 실수
      [{ h, m: (m + 5) % 60 }, { h, m: (m + 55) % 60 }, { h: H(h + 1), m: (m + 30) % 60 }, { h: H(h - 1), m }, { h: H(h + 2), m }].forEach(add);
      for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const x = out[i]; out[i] = out[j]; out[j] = x; }
      return { h, m, choices: out, answer: out.findIndex(c => c.h === h && c.m === m) };
    },
    /* 돈: level 1 = 천·백 · 2 = 만·천·백 · 3 = 십만·만·천·백. 한 단위는 0~9장(자릿값 그대로), 가장 큰 단위는 1장 이상
     * → { counts: { 100000: n, … }, total, choices: [원], answer } */
    UNITS: [100000, 10000, 1000, 100],
    money(level, rnd, forced) {
      const lv = Math.max(1, Math.min(3, level || 1));
      const units = Study.UNITS.slice(3 - lv);
      let counts;
      if (forced) counts = Object.assign({}, forced);
      else {
        do {
          counts = {};
          units.forEach((u, i) => { counts[u] = i === 0 ? 1 + Math.floor(rnd() * 9) : Math.floor(rnd() * 10); });
        } while (units.filter(u => counts[u] > 0).length < 2);
      }
      Study.UNITS.forEach(u => { counts[u] = counts[u] || 0; });
      const total = Study.UNITS.reduce((t, u) => t + u * counts[u], 0);
      const out = [total], seen = {};
      seen[total] = 1;
      const add = v => { if (v > 0 && v < 10000000 && v % 10 === 0 && !seen[v] && out.length < 4) { seen[v] = 1; out.push(v); } }; // 3,250원처럼 자리를 덜 센 값도 보기로
      const present = Study.UNITS.filter(u => counts[u] > 0);
      if (present.length >= 2) { // 두 단위의 장 수를 바꿔 읽는 실수 (32,500 ↔ 23,500)
        const a = present[0], b = present[1];
        add(total - a * counts[a] - b * counts[b] + a * counts[b] + b * counts[a]);
      }
      add(total / 10);   // 자리를 하나 덜 셈 (3,250)
      add(total * 10);   // 자리를 하나 더 셈 (325,000)
      present.forEach(u => { add(total + u); add(total - u); }); // 한 장 더·덜
      [1000, 10000, 100].forEach(u => { add(total + u); add(total + 2 * u); });
      for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const x = out[i]; out[i] = out[j]; out[j] = x; }
      return { counts, total, choices: out, answer: out.indexOf(total) };
    },
    // 32500 → "thirty-two thousand five hundred" (영어판: 소리 내어 읽는 영어 숫자. 이름은 옛 그대로 koNum)
    koNum(n) {
      const ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
        "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
      const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
      const two = x => x < 20 ? ONES[x] : TENS[Math.floor(x / 10)] + (x % 10 ? "-" + ONES[x % 10] : "");
      const three = x => [x >= 100 ? ONES[Math.floor(x / 100)] + " hundred" : "", x % 100 ? two(x % 100) : ""].filter(Boolean).join(" ");
      n = Math.floor(Math.abs(Number(n) || 0));
      if (!n) return "zero";
      const out = [];
      [[1e9, "billion"], [1e6, "million"], [1e3, "thousand"], [1, ""]].forEach(([u, w]) => {
        const d = Math.floor(n / u) % 1000;
        if (d) out.push(three(d) + (w ? " " + w : ""));
      });
      return out.join(" ");
    },
    won: n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + " won",
    // 디지털 시계 모양: 3:05 · 정각은 "3 o'clock"
    clockText: c => c.m ? c.h + ":" + String(c.m).padStart(2, "0") : c.h + " o'clock",
  };

  const Yut = {
    NODES, NODE_KIND, NODE_NAME, LINES, ROUTES, RESULTS, BACKDO, FLAT_P,
    rand, rng, throwSticks, sticksFor, resultProbs, settle, stepMove, posOf, unitsOf, waitingOf,
    legalMoves, applyThrow, applyMove, newGame, teamDone,
    evoPath, progressOf, stageFor, formOf, EVO_STEP, isFinal, SKILL_WALK, needsWalk, skillNeed, Study,
    remainingOf, threat, cpuScore, cpuChoose, validate, upgrade, clone,
    SPOT_NODES, pickSpotNodes, Rewards,
    // v3: 기술 · 말 바꾸기
    SKILLS, TYPE_SKILLS, REFLECTABLE, legalSkills, targetsFor, applySkill, scoreSkill, cpuSkill,
    CHANCE, MATCH_SKILLS, TYPE_CHART, typeEff, skillChance, matchup, leadFoe, outrageFoes, confusedPlan, stepMod, isConfused, RENAMED, migrate8,
    giftReady, giftTargets, applyGift, autoGiftTarget,
    applySwap, swapOk, cpuSwapTarget,
    isBlocked, isVeiled, isSealed, isRaining, unitOfPiece, piecesAt, trapAt, flyPlan, planForward, backPlan, backSteps,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = Yut;
  else root.Yut = Yut;
})(typeof window !== "undefined" ? window : this);
