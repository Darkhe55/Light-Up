// src/types.ts
var WALL = -1;

// src/state.ts
function cellIndex(w, cx, cy) {
  return cy * w + cx;
}
function neighbors4(w, h, cx, cy) {
  const out = [];
  if (cx > 0) out.push({ cx: cx - 1, cy });
  if (cx < w - 1) out.push({ cx: cx + 1, cy });
  if (cy > 0) out.push({ cx, cy: cy - 1 });
  if (cy < h - 1) out.push({ cx, cy: cy + 1 });
  return out;
}
function isWall(puzzle, index) {
  return puzzle.cells[index] !== null && puzzle.cells[index] !== void 0;
}
function clueAt(puzzle, index) {
  const c = puzzle.cells[index];
  if (c === null || c === void 0 || c === WALL) return null;
  return c;
}
function clueWallPositions(puzzle) {
  const out = [];
  const w = puzzle.width;
  const h = puzzle.height;
  for (let cy = 0; cy < h; cy++) {
    for (let cx = 0; cx < w; cx++) {
      const index = cellIndex(w, cx, cy);
      const clue = clueAt(puzzle, index);
      if (clue === null) continue;
      const adj = neighbors4(w, h, cx, cy).map((nb) => cellIndex(w, nb.cx, nb.cy)).filter((j) => !isWall(puzzle, j));
      out.push({ cx, cy, index, clue, adj });
    }
  }
  return out;
}
var modelCache = /* @__PURE__ */ new WeakMap();
function buildModel(puzzle) {
  const cached = modelCache.get(puzzle);
  if (cached) return cached;
  const w = puzzle.width;
  const h = puzzle.height;
  const wall = new Array(w * h).fill(false);
  const clue = new Array(w * h).fill(null);
  for (let i = 0; i < w * h; i++) {
    const c = puzzle.cells[i];
    if (c === null || c === void 0) continue;
    wall[i] = true;
    if (c !== WALL) clue[i] = c;
  }
  const rowSeg = new Int32Array(w * h).fill(-1);
  const colSeg = new Int32Array(w * h).fill(-1);
  const rowSegCells = [];
  const colSegCells = [];
  for (let cy = 0; cy < h; cy++) {
    let seg = -1;
    for (let cx = 0; cx < w; cx++) {
      const i = cellIndex(w, cx, cy);
      if (wall[i]) {
        seg = -1;
        continue;
      }
      if (seg < 0) {
        seg = rowSegCells.length;
        rowSegCells.push([]);
      }
      rowSeg[i] = seg;
      rowSegCells[seg].push(i);
    }
  }
  for (let cx = 0; cx < w; cx++) {
    let seg = -1;
    for (let cy = 0; cy < h; cy++) {
      const i = cellIndex(w, cx, cy);
      if (wall[i]) {
        seg = -1;
        continue;
      }
      if (seg < 0) {
        seg = colSegCells.length;
        colSegCells.push([]);
      }
      colSeg[i] = seg;
      colSegCells[seg].push(i);
    }
  }
  const clueAdj = [];
  for (const cw of clueWallPositions(puzzle)) {
    clueAdj[cw.index] = cw.adj;
  }
  const whites = [];
  for (let i = 0; i < w * h; i++) if (!wall[i]) whites.push(i);
  const model = {
    w,
    h,
    wall,
    clue,
    rowSeg,
    colSeg,
    rowSegCells,
    colSegCells,
    clueAdj,
    whites,
    bulbInSeg: new Int32Array(rowSegCells.length + colSegCells.length).fill(-1)
  };
  modelCache.set(puzzle, model);
  return model;
}
function createEmptyState(puzzle) {
  return {
    puzzleId: puzzle.id,
    width: puzzle.width,
    height: puzzle.height,
    cells: new Array(puzzle.width * puzzle.height).fill(0 /* Unknown */)
  };
}

// src/store.ts
var EMPTY = { version: 1, library: [], progress: {}, lastPuzzle: null };
var cache = { ...EMPTY, library: [], progress: {} };

// src/library.ts
function parseCells(s) {
  return [...s].map((ch) => {
    if (ch === ".") return null;
    if (ch === "#") return WALL;
    const n = Number(ch);
    return Number.isInteger(n) && n >= 0 && n <= 4 ? n : null;
  });
}

// src/puzzles-data.ts
var RAW_PUZZLES = [
  { id: "starter-5x5", name: "\u5165\u95E8 \xB7 5\xD75", width: 5, height: 5, difficulty: "easy", series: "starter", cells: "..0.0..3.1.3........0.0..", solution: "o.....o.o...o...o.......o" },
  { id: "starter-6x6", name: "\u5165\u95E8 \xB7 6\xD76", width: 6, height: 6, difficulty: "easy", series: "starter", cells: "0...1...3..20.1....1...2..2.2..1.2..", solution: "..o..o.o.o.......o..o...o....o..o.o." },
  { id: "starter-7x7", name: "\u5165\u95E8 \xB7 7\xD77", width: 7, height: 7, difficulty: "easy", series: "starter", cells: "..2..0.01..................2.3..02.............20", solution: ".o.o.......o........o.o.....o.o...o.....o.....o.." },
  { id: "classic-8x8-A", name: "\u7ECF\u5178 \xB7 8\xD78 A", width: 8, height: 8, difficulty: "medium", series: "classic", cells: ".....01..211.1...2..1...2....0...2.0....1..1...1.....1..1.1....1", solution: ".o.....oo...o.....o...o..o......o............o.....o...o.o..o..." },
  { id: "classic-8x8-B", name: "\u7ECF\u5178 \xB7 8\xD78 B", width: 8, height: 8, difficulty: "medium", series: "classic", cells: ".....2......1..0.2..11.11........0.......1.10.....1.2...1..2....", solution: "..o...o..o...o..o..o...........o.....o..o..........o.....o..o..." },
  { id: "classic-9x9", name: "\u7ECF\u5178 \xB7 9\xD79", width: 9, height: 9, difficulty: "medium", series: "classic", cells: "100....1............3....1..2..2............001.0........0.....1..0...2.....0...2", solution: "......o..o.........o.o....o..o..o.......o...........o..o...............oo......o." },
  { id: "classic-10x10", name: "\u7ECF\u5178 \xB7 10\xD710", width: 10, height: 10, difficulty: "medium", series: "classic", cells: ".1.00.0..21.....1...........01..10.1.200..2.....111..3.1..1...2.3.0.1.2......1.2.3..2..1.....0.....1", solution: "o.......o......o...o..o.......o.....o....o.....o....o.o....oo..o..........o...o.o.o..o...o.o.....o.." },
  { id: "challenge-10x10-B", name: "\u6311\u6218 \xB7 10\xD710 B", width: 10, height: 10, difficulty: "hard", series: "challenge", cells: ".........03.......0...01....3.....2....21.......1...01.2......1.3.2.........0.1.0...1...........01..", solution: "o..........o........o......o.o...o....o.....o.....o.....o......o.o..o.....o..............o..o.....o." },
  { id: "challenge-12x12", name: "\u6311\u6218 \xB7 12\xD712", width: 12, height: 12, difficulty: "hard", series: "challenge", cells: ".3............30...1.100....1......0...2.2...1....1.3.....1.01..11..1...2..1.10.1.11..........0.....01.1..1..0.02..01....0.1.3.1.1...0.0......1.", solution: "o.o..........o...o..o.....o...o.........o.....o....o.o.............o...o.o..o....o..o.............o.....o..o.....o..........o.o...o.........o..." }
];

// src/puzzles.ts
function solutionBulbs(solution) {
  return [...solution].map((ch) => ch === "o");
}
function toPuzzle(r) {
  return {
    id: r.id,
    name: r.name,
    width: r.width,
    height: r.height,
    difficulty: r.difficulty,
    cells: parseCells(r.cells),
    solution: r.solution
  };
}
var puzzles = RAW_PUZZLES.map(toPuzzle);
var solutions = /* @__PURE__ */ new Map();
for (const r of RAW_PUZZLES) {
  if (r.solution) solutions.set(r.id, r.solution);
}
function stateFromReference(puzzle) {
  const sol = puzzle.solution;
  if (!sol) return null;
  const st = createEmptyState(puzzle);
  const bulbs = solutionBulbs(sol);
  for (let i = 0; i < bulbs.length; i++) {
    const c = puzzle.cells[i] ?? null;
    if (c !== null) continue;
    st.cells[i] = bulbs[i] ? 1 : 2;
  }
  return st;
}

// src/logic.ts
var RULE_LABELS = {
  1: "\u6570\u5B57\u5899\u706F\u6CE1\u6570\u5DF2\u591F\uFF0C\u5176\u4F59\u90BB\u683C\u6392\u9664",
  2: "\u6570\u5B57\u5899\u8FD8\u5DEE\u7684\u706F\u6CE1\u6570\u53EA\u5269\u8FD9\u4E9B\u4F4D\u7F6E",
  3: "\u8BE5\u683C\u53EA\u80FD\u7531\u8FD9\u4E00\u4E2A\u4F4D\u7F6E\u7167\u4EAE",
  4: "\u653E\u706F\u6CE1\u4F1A\u8BA9\u8FD9\u9762\u6570\u5B57\u5899\u51D1\u4E0D\u591F\u706F\u6CE1"
};
function posLabel(w, i) {
  return `(${i % w},${Math.floor(i / w)})`;
}
function planLogicSolve(puzzle, start) {
  const model = buildModel(puzzle);
  const cells = start ? start.cells.slice() : createEmptyState(puzzle).cells.slice();
  for (let i = 0; i < cells.length; i++) {
    if (model.wall[i]) cells[i] = 0 /* Unknown */;
  }
  const lit = new Uint8Array(model.w * model.h).fill(0);
  const lightUp = (i) => {
    for (const j of model.rowSegCells[model.rowSeg[i]]) lit[j] = 1;
    for (const j of model.colSegCells[model.colSeg[i]]) lit[j] = 1;
  };
  for (const i of model.whites) {
    if (cells[i] === 1 /* Bulb */) lightUp(i);
  }
  const steps = [];
  const w = puzzle.width;
  const setCell = (i, v, rule, extra = "") => {
    if (cells[i] !== 0 /* Unknown */) return false;
    cells[i] = v;
    if (v === 1 /* Bulb */) lightUp(i);
    steps.push({
      index: i,
      value: v,
      rule,
      label: `${RULE_LABELS[rule]}${extra} \xB7 ${posLabel(w, i)}`
    });
    return true;
  };
  const groups = /* @__PURE__ */ new Map();
  for (const i of model.whites) {
    if (lit[i]) continue;
    const g = /* @__PURE__ */ new Set();
    for (const j of model.rowSegCells[model.rowSeg[i]]) if (!lit[j]) g.add(j);
    for (const j of model.colSegCells[model.colSeg[i]]) if (!lit[j]) g.add(j);
    groups.set(i, g);
  }
  for (; ; ) {
    let changed = false;
    for (const cw of clueWallPositions(puzzle)) {
      let near = 0;
      const cands = [];
      for (const j of cw.adj) {
        if (cells[j] === 1 /* Bulb */) near++;
        else if (cells[j] === 0 /* Unknown */ && !lit[j]) cands.push(j);
      }
      if (near > cw.clue) continue;
      if (near === cw.clue) {
        for (const j of cands) {
          if (setCell(j, 2 /* Mark */, 1, `\uFF08\u6570\u5B57 ${cw.clue} \u5DF2\u6EE1\u8DB3\uFF09`)) changed = true;
        }
      } else if (cands.length === cw.clue - near) {
        for (const j of cands) {
          if (setCell(j, 1 /* Bulb */, 2, `\uFF08\u6570\u5B57 ${cw.clue} \u8FD8\u5DEE ${cw.clue - near}\uFF09`)) changed = true;
        }
      }
    }
    for (const i of [...groups.keys()]) {
      if (lit[i]) groups.delete(i);
    }
    for (const g of groups.values()) {
      for (const j of [...g]) {
        if (lit[j] || cells[j] === 2 /* Mark */) g.delete(j);
      }
    }
    for (const [i, g] of [...groups]) {
      if (g.size !== 1) continue;
      const only = g.values().next().value;
      if (only === void 0) continue;
      if (setCell(only, 1 /* Bulb */, 3, `\uFF08\u7167\u4EAE ${posLabel(w, i)}\uFF09`)) changed = true;
    }
    const wallInfo = [];
    for (const cw of clueWallPositions(puzzle)) {
      let near = 0;
      const cands = [];
      for (const j of cw.adj) {
        if (cells[j] === 1 /* Bulb */) near++;
        else if (cells[j] === 0 /* Unknown */ && !lit[j]) cands.push(j);
      }
      if (near > cw.clue) continue;
      if (near + cands.length < cw.clue) continue;
      if (!cands.length) continue;
      wallInfo.push({ clue: cw.clue, near, cands });
    }
    for (const X of model.whites) {
      if (cells[X] !== 0 /* Unknown */ || lit[X]) continue;
      for (const wi of wallInfo) {
        let hit = 0;
        for (const j of wi.cands) {
          if (model.rowSeg[j] === model.rowSeg[X] || model.colSeg[j] === model.colSeg[X]) hit++;
        }
        if (hit === 0) continue;
        const adj = wi.cands.includes(X) ? 1 : 0;
        if (wi.near + adj + wi.cands.length - hit < wi.clue) {
          if (setCell(
            X,
            2 /* Mark */,
            4,
            `\uFF08\u6570\u5B57 ${wi.clue} \u53EF\u653E\u4F4D ${wi.cands.length} \u2192 ${wi.cands.length - hit}\uFF09`
          )) {
            changed = true;
          }
          break;
        }
      }
    }
    if (!changed) break;
  }
  const finalState = {
    puzzleId: puzzle.id,
    width: puzzle.width,
    height: puzzle.height,
    cells
  };
  const complete = model.whites.every((i) => cells[i] !== 0 /* Unknown */ || lit[i] === 1);
  return { puzzleId: puzzle.id, steps, finalState, complete };
}

// src/validate.ts
function litGrid(puzzle, state) {
  const m = buildModel(puzzle);
  const lit = new Array(m.w * m.h).fill(false);
  for (const cells of m.rowSegCells) {
    let has = false;
    for (const i of cells) if (state.cells[i] === 1 /* Bulb */) has = true;
    if (!has) continue;
    for (const i of cells) lit[i] = true;
  }
  for (const cells of m.colSegCells) {
    let has = false;
    for (const i of cells) if (state.cells[i] === 1 /* Bulb */) has = true;
    if (!has) continue;
    for (const i of cells) lit[i] = true;
  }
  return lit;
}
function conflictBulbSet(puzzle, state) {
  const m = buildModel(puzzle);
  const bad = /* @__PURE__ */ new Set();
  const scan = (segments) => {
    for (const cells of segments) {
      const bulbs = cells.filter((i) => state.cells[i] === 1 /* Bulb */);
      if (bulbs.length > 1) for (const b of bulbs) bad.add(b);
    }
  };
  scan(m.rowSegCells);
  scan(m.colSegCells);
  return bad;
}
function validate(state, puzzle) {
  const w = puzzle.width;
  const h = puzzle.height;
  const overWalls = [];
  const underWalls = [];
  for (const cw of clueWallPositions(puzzle)) {
    let n = 0;
    for (const j of cw.adj) if (state.cells[j] === 1 /* Bulb */) n++;
    if (n > cw.clue) overWalls.push(cw.index);
    else if (n < cw.clue) underWalls.push(cw.index);
  }
  const conflicts = conflictBulbSet(puzzle, state);
  const lit = litGrid(puzzle, state);
  let bulbCount = 0;
  let litCount = 0;
  const darkCells = [];
  for (let cy = 0; cy < h; cy++) {
    for (let cx = 0; cx < w; cx++) {
      const i = cellIndex(w, cx, cy);
      if (isWall(puzzle, i)) continue;
      if (state.cells[i] === 1 /* Bulb */) bulbCount++;
      if (lit[i]) litCount++;
      else darkCells.push(i);
    }
  }
  const solved = overWalls.length === 0 && underWalls.length === 0 && conflicts.size === 0 && darkCells.length === 0;
  return {
    overWalls,
    underWalls,
    conflictBulbs: [...conflicts],
    darkCells,
    bulbCount,
    litCount,
    solved
  };
}

// scripts/logic-test.mts
var fail = 0;
var failIf = (cond, msg) => {
  if (cond) {
    console.log(`  \u2717 ${msg}`);
    fail++;
    return true;
  }
  return false;
};
var wrap = (p, cells) => ({
  puzzleId: p.id,
  width: p.width,
  height: p.height,
  cells
});
console.log(`\u903B\u8F91\u5F15\u64CE\u81EA\u68C0\uFF1A${puzzles.length} \u9053\u9898 \xD7 2 \u79CD\u8D77\u70B9
`);
for (const p of puzzles) {
  const ref = stateFromReference(p);
  const refBulbs = new Set(
    ref.cells.map((v, i) => v === 1 /* Bulb */ ? i : -1).filter((i) => i >= 0)
  );
  const empty = new Array(p.width * p.height).fill(0 /* Unknown */);
  const half = empty.slice();
  let k = 0;
  for (const i of refBulbs) {
    if (k++ % 2 === 0) half[i] = 1 /* Bulb */;
  }
  for (const [label, start] of [
    ["\u7A7A\u76D8", empty],
    ["\u534A\u6EE1", half]
  ]) {
    const plan = planLogicSolve(p, wrap(p, start));
    const cells = start.slice();
    let markOnLit = 0;
    let bulbOnBad = 0;
    let conflicts = 0;
    let overs = 0;
    let bulbSteps = 0;
    let markSteps = 0;
    let unsoundMark = 0;
    const ruleHits = [0, 0, 0, 0, 0];
    for (const step of plan.steps) {
      ruleHits[step.rule] = (ruleHits[step.rule] ?? 0) + 1;
      const lit = litGrid(p, wrap(p, cells));
      if (step.value === 2 /* Mark */) {
        markSteps++;
        if (lit[step.index]) markOnLit++;
        if (ref.cells[step.index] === 1 /* Bulb */) unsoundMark++;
      } else {
        bulbSteps++;
        if (lit[step.index] || cells[step.index] !== 0 /* Unknown */) bulbOnBad++;
      }
      cells[step.index] = step.value;
      const v = validate(wrap(p, cells), p);
      if (v.conflictBulbs.length) conflicts++;
      if (v.overWalls.length) overs++;
    }
    const litEnd = litGrid(p, wrap(p, cells));
    const finalV = validate(wrap(p, cells), p);
    const finalBulbs = new Set(
      cells.map((v, i) => v === 1 /* Bulb */ ? i : -1).filter((i) => i >= 0)
    );
    const notInRef = [...finalBulbs].filter((i) => !refBulbs.has(i));
    const litUnknown = cells.filter((v, i) => v === 0 /* Unknown */ && litEnd[i]).length;
    let bad = false;
    bad ||= failIf(markOnLit > 0, `${label}\uFF1A${markOnLit} \u6B21\u628A\u4EAE\u683C\u6253\u53C9`);
    bad ||= failIf(bulbOnBad > 0, `${label}\uFF1A${bulbOnBad} \u6B21\u5728\u4EAE\u683C/\u53C9\u683C\u4E0A\u653E\u706F\u6CE1`);
    bad ||= failIf(conflicts > 0, `${label}\uFF1A${conflicts} \u6B65\u540E\u51FA\u73B0\u706F\u6CE1\u4E92\u7167`);
    bad ||= failIf(overs > 0, `${label}\uFF1A${overs} \u6B65\u540E\u51FA\u73B0\u6570\u5B57\u5899\u8D85\u989D`);
    bad ||= failIf(notInRef.length > 0, `${label}\uFF1A\u7EC8\u6001\u653E\u4E86 ${notInRef.length} \u4E2A\u975E\u53C2\u8003\u89E3\u706F\u6CE1`);
    bad ||= failIf(unsoundMark > 0, `${label}\uFF1A${unsoundMark} \u6B21\u628A\u53C2\u8003\u89E3\u706F\u6CE1\u6253\u53C9\uFF08\u6807\u8BB0\u4E0D\u53EF\u9760\uFF09`);
    if (plan.complete) {
      bad ||= failIf(!finalV.solved, `${label}\uFF1Acomplete \u4F46\u76D8\u9762\u672A\u89E3\u51FA`);
      bad ||= failIf(
        finalBulbs.size !== refBulbs.size,
        `${label}\uFF1Acomplete \u4F46\u706F\u6CE1\u6570 ${finalBulbs.size} \u2260 \u53C2\u8003\u89E3 ${refBulbs.size}`
      );
    }
    if (!bad) {
      console.log(
        `  \u2713 ${p.id} [${label}] ${plan.steps.length} \u6B65\uFF08\u706F\u6CE1 ${bulbSteps} / \u6253\u53C9 ${markSteps}\uFF09 \xB7 \u89C4\u5219\u547D\u4E2D R1=${ruleHits[1]} R2=${ruleHits[2]} R3=${ruleHits[3]} R4=${ruleHits[4]} \xB7 \u4EAE\u683C\u672A\u6253\u53C9 ${litUnknown} \xB7 complete=${plan.complete}${finalV.solved ? " \xB7 \u5DF2\u89E3\u51FA" : ""}`
      );
    }
  }
}
console.log("");
{
  const w = 5;
  const board = new Array(w * w).fill(null);
  board[2 * w + 2] = 3;
  const p = {
    id: "synthetic-r4",
    name: "\u5408\u6210 \xB7 R4",
    width: w,
    height: w,
    cells: board,
    difficulty: "custom"
  };
  const plan = planLogicSolve(p);
  const marks = plan.steps.filter((s) => s.value === 2 /* Mark */);
  const bulbs = plan.steps.filter((s) => s.value === 1 /* Bulb */);
  const markSet = new Set(marks.map((s) => s.index));
  const diag = [1 * w + 1, 3 * w + 1, 1 * w + 3, 3 * w + 3];
  let sbad = false;
  sbad ||= failIf(
    !diag.every((i) => markSet.has(i)),
    `R4 \u5408\u6210\u9898\uFF1A\u5BF9\u89D2\u683C\u672A\u5168\u90E8\u6253\u53C9\uFF08\u5B9E\u9645\u6253\u53C9 ${[...markSet].join(",")}\uFF09`
  );
  sbad ||= failIf(
    [...markSet].some((i) => !diag.includes(i)),
    `R4 \u5408\u6210\u9898\uFF1A\u6253\u53C9\u4E86\u975E\u5BF9\u89D2\u683C ${[...markSet].filter((i) => !diag.includes(i)).join(",")}`
  );
  sbad ||= failIf(marks.some((s) => s.rule !== 4), "R4 \u5408\u6210\u9898\uFF1A\u5B58\u5728\u975E R4 \u7684\u6253\u53C9\u6B65\u9AA4");
  sbad ||= failIf(bulbs.length > 0, `R4 \u5408\u6210\u9898\uFF1A\u4E0D\u5E94\u76F4\u63A5\u63A8\u51FA\u706F\u6CE1\uFF08${bulbs.length} \u4E2A\uFF09`);
  if (!sbad) {
    console.log(`  \u2713 \u5408\u6210\u9898 R4\uFF1A${marks.length} \u4E2A\u5BF9\u89D2\u683C\u5168\u90E8\u7531\u89C4\u5219 4 \u6253\u53C9\uFF0C\u65E0\u706F\u6CE1\u63A8\u8BBA`);
  }
}
if (fail) {
  console.log(`\u5931\u8D25 ${fail} \u9879`);
  process.exit(1);
}
console.log("\u903B\u8F91\u5F15\u64CE\u81EA\u68C0\u5168\u90E8\u901A\u8FC7");
