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

// src/imported-puzzles.ts
var IMPORTED_PUZZLES = [];

// src/puzzles.ts
var ALL_RAW = [...RAW_PUZZLES, ...IMPORTED_PUZZLES];
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
var puzzles = ALL_RAW.map(toPuzzle);
var solutions = /* @__PURE__ */ new Map();
for (const r of ALL_RAW) {
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

// src/solver.ts
var Searcher = class {
  m;
  puzzle;
  cells;
  /** 行段/列段里的灯泡格（-1 = 无）；列段号整体偏移 rowCount */
  segBulb;
  rowCount;
  /** 数字墙：已放灯泡数 / 仍未定邻格数 */
  clueBulbs;
  clueFree;
  /** 照亮位图 */
  lit;
  /** 数字墙索引列表 */
  clueWalls;
  trail = [];
  maxNodes;
  deadline;
  rng;
  nodes = 0;
  timedOut = false;
  constructor(puzzle, opts = {}) {
    this.puzzle = puzzle;
    this.m = buildModel(puzzle);
    const total = this.m.w * this.m.h;
    this.cells = new Array(total).fill(0 /* Unknown */);
    this.rowCount = this.m.rowSegCells.length;
    this.segBulb = new Int32Array(this.rowCount + this.m.colSegCells.length).fill(-1);
    this.clueBulbs = new Int32Array(total).fill(0);
    this.clueFree = new Int32Array(total).fill(0);
    this.lit = new Uint8Array(total).fill(0);
    this.clueWalls = [];
    for (let i = 0; i < total; i++) {
      if (this.m.clue[i] !== null) this.clueWalls.push(i);
    }
    for (const w of this.clueWalls) {
      this.clueFree[w] = this.m.clueAdj[w]?.length ?? 0;
    }
    this.maxNodes = opts.maxNodes ?? 4e5;
    this.deadline = opts.timeBudgetMs ? Date.now() + opts.timeBudgetMs : 0;
    this.rng = opts.rng ?? null;
  }
  colSegId(i) {
    return this.rowCount + this.m.colSeg[i];
  }
  placeBulbOk(i) {
    return this.segBulb[this.m.rowSeg[i]] === -1 && this.segBulb[this.colSegId(i)] === -1;
  }
  assign(i, v) {
    this.cells[i] = v;
    const entry = { i, v, litAdded: [] };
    this.trail.push(entry);
    if (v === 1 /* Bulb */) {
      const rs = this.m.rowSeg[i];
      const cs = this.colSegId(i);
      this.segBulb[rs] = i;
      this.segBulb[cs] = i;
      for (const j of this.m.rowSegCells[rs]) {
        if (!this.lit[j]) {
          this.lit[j] = 1;
          entry.litAdded.push(j);
        }
      }
      for (const j of this.m.colSegCells[cs - this.rowCount]) {
        if (!this.lit[j]) {
          this.lit[j] = 1;
          entry.litAdded.push(j);
        }
      }
      for (const w of this.adjWallsOf(i)) {
        this.clueBulbs[w]++;
        this.clueFree[w]--;
      }
    } else if (v === 2 /* Mark */) {
      for (const w of this.adjWallsOf(i)) this.clueFree[w]--;
    }
  }
  /** 空地 i 四邻的数字墙索引 */
  adjWallsOf(i) {
    const w = this.m.w;
    const cx = i % w;
    const cy = Math.floor(i / w);
    const out = [];
    if (cx > 0) {
      const j = i - 1;
      if (this.m.clue[j] !== null) out.push(j);
    }
    if (cx < w - 1) {
      const j = i + 1;
      if (this.m.clue[j] !== null) out.push(j);
    }
    if (cy > 0) {
      const j = i - w;
      if (this.m.clue[j] !== null) out.push(j);
    }
    if (cy < this.m.h - 1) {
      const j = i + w;
      if (this.m.clue[j] !== null) out.push(j);
    }
    return out;
  }
  undoTo(mark) {
    while (this.trail.length > mark) {
      const e = this.trail.pop();
      this.cells[e.i] = 0 /* Unknown */;
      if (e.v === 1 /* Bulb */) {
        const rs = this.m.rowSeg[e.i];
        const cs = this.colSegId(e.i);
        if (this.segBulb[rs] === e.i) this.segBulb[rs] = -1;
        if (this.segBulb[cs] === e.i) this.segBulb[cs] = -1;
        for (const j of e.litAdded) this.lit[j] = 0;
        for (const w of this.adjWallsOf(e.i)) {
          this.clueBulbs[w]--;
          this.clueFree[w]++;
        }
      } else if (e.v === 2 /* Mark */) {
        for (const w of this.adjWallsOf(e.i)) this.clueFree[w]++;
      }
    }
  }
  /** 传播到不动点；矛盾返回 false（状态已回滚到进入前） */
  propagate() {
    for (; ; ) {
      let changed = false;
      for (const w of this.clueWalls) {
        const need = this.m.clue[w] - this.clueBulbs[w];
        if (need < 0) return false;
        const adj = this.m.clueAdj[w] ?? [];
        if (need === 0) {
          for (const j of adj) {
            if (this.cells[j] === 0 /* Unknown */) {
              this.assign(j, 2 /* Mark */);
              changed = true;
            }
          }
        } else {
          const free = this.clueFree[w];
          if (free < need) return false;
          if (free === need) {
            for (const j of adj) {
              if (this.cells[j] !== 0 /* Unknown */) continue;
              if (!this.placeBulbOk(j)) return false;
              this.assign(j, 1 /* Bulb */);
              changed = true;
            }
          }
        }
      }
      for (const i of this.m.whites) {
        if (this.lit[i]) continue;
        let cand = -1;
        let count = 0;
        for (const j of this.m.rowSegCells[this.m.rowSeg[i]]) {
          if (this.cells[j] === 0 /* Unknown */ && this.placeBulbOk(j)) {
            count++;
            cand = j;
            if (count > 1) break;
          }
        }
        if (count <= 1) {
          for (const j of this.m.colSegCells[this.m.colSeg[i]]) {
            if (this.cells[j] === 0 /* Unknown */ && this.placeBulbOk(j)) {
              count++;
              cand = j;
              if (count > 1) break;
            }
          }
        }
        if (count === 0) return false;
        if (count === 1) {
          this.assign(cand, 1 /* Bulb */);
          changed = true;
        }
      }
      if (!changed) return true;
    }
  }
  /** 选一个未定格分支；-1 = 全部已定 */
  pickBranch() {
    for (const w of this.clueWalls) {
      if (this.clueBulbs[w] >= this.m.clue[w]) continue;
      for (const j of this.m.clueAdj[w] ?? []) {
        if (this.cells[j] === 0 /* Unknown */) return j;
      }
    }
    for (const i of this.m.whites) {
      if (this.cells[i] === 0 /* Unknown */ && !this.lit[i]) return i;
    }
    for (const i of this.m.whites) {
      if (this.cells[i] === 0 /* Unknown */) return i;
    }
    return -1;
  }
  checkBudget() {
    if (this.nodes > this.maxNodes) {
      this.timedOut = true;
      return false;
    }
    if (this.deadline && (this.nodes & 2047) === 0 && Date.now() > this.deadline) {
      this.timedOut = true;
      return false;
    }
    return true;
  }
  search(onFound) {
    const dfs = () => {
      this.nodes++;
      if (!this.checkBudget()) return true;
      const mark = this.trail.length;
      if (!this.propagate()) {
        this.undoTo(mark);
        return false;
      }
      const i = this.pickBranch();
      if (i < 0) return onFound(this.cells.slice());
      let order;
      if (this.rng && this.rng() < 0.5) order = [2 /* Mark */, 1 /* Bulb */];
      else order = [1 /* Bulb */, 2 /* Mark */];
      for (const v of order) {
        if (v === 1 /* Bulb */ && !this.placeBulbOk(i)) continue;
        this.assign(i, v);
        if (dfs()) return true;
        this.undoTo(mark);
      }
      this.undoTo(mark);
      return false;
    };
    return dfs();
  }
  toState(cells) {
    const st = createEmptyState(this.puzzle);
    for (let i = 0; i < cells.length; i++) st.cells[i] = cells[i];
    return st;
  }
  /** 格子总数 */
  cellsLength() {
    return this.m.w * this.m.h;
  }
};
function countSolutions(puzzle, limit = 2, opts = {}) {
  const s = new Searcher(puzzle, opts);
  let count = 0;
  let first = null;
  let second = null;
  s.search((cells) => {
    count++;
    if (!first) first = s.toState(cells);
    else if (!second) second = s.toState(cells);
    return count >= limit;
  });
  return {
    count,
    capped: count >= limit,
    nodes: s.nodes,
    timedOut: s.timedOut,
    first,
    second
  };
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

// scripts/check.mts
var fail = 0;
var failIf = (cond, msg) => {
  if (cond) {
    console.log(`  \u2717 ${msg}`);
    fail++;
    return true;
  }
  return false;
};
console.log(`\u5171 ${puzzles.length} \u9053\u9898
`);
for (const p of puzzles) {
  const w = p.width;
  const h = p.height;
  console.log(`${p.id}  ${w}\xD7${h}  ${p.difficulty}`);
  let bad = false;
  bad ||= failIf(p.cells.length !== w * h, `cells \u957F\u5EA6 ${p.cells.length} \u2260 ${w * h}`);
  bad ||= failIf(!p.solution || p.solution.length !== w * h, "solution \u957F\u5EA6\u4E0D\u5BF9");
  if (bad) continue;
  let walls = 0;
  let bulbs = 0;
  for (let i = 0; i < w * h; i++) {
    if (isWall(p, i)) walls++;
    if (p.solution[i] === "o") bulbs++;
  }
  bad ||= failIf(walls === 0, "\u6CA1\u6709\u5899");
  bad ||= failIf(bulbs === 0, "\u53C2\u8003\u89E3\u6CA1\u6709\u706F\u6CE1");
  const st = stateFromReference(p);
  const v = validate(st, p);
  bad ||= failIf(!v.solved, `\u53C2\u8003\u89E3\u4E0D\u5408\u6CD5\uFF1A${JSON.stringify(v).slice(0, 200)}`);
  const r = countSolutions(p, 2, { maxNodes: 2e6, timeBudgetMs: 3e4 });
  bad ||= failIf(r.timedOut, "\u552F\u4E00\u89E3\u6821\u9A8C\u8D85\u65F6");
  bad ||= failIf(r.count !== 1, `\u89E3\u6570 = ${r.count}\uFF08\u5E94\u4E3A 1\uFF09`);
  if (!bad) console.log(`  \u2713 \u53C2\u8003\u89E3\u5408\u6CD5 \xB7 \u552F\u4E00\u89E3 \xB7 \u5899 ${walls} \xB7 \u706F\u6CE1 ${bulbs}`);
}
console.log("");
if (fail) {
  console.log(`\u5931\u8D25 ${fail} \u9879`);
  process.exit(1);
}
console.log("\u5168\u90E8\u901A\u8FC7");
