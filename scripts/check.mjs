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
  const regionOf = new Int32Array(w * h).fill(-1);
  const regions = [];
  for (let start = 0; start < w * h; start++) {
    if (wall[start] || regionOf[start] !== -1) continue;
    const id = regions.length;
    const list = [];
    regionOf[start] = id;
    const stack = [start];
    while (stack.length) {
      const i = stack.pop();
      list.push(i);
      const cx = i % w;
      const cy = Math.floor(i / w);
      const nbs = [
        cx > 0 ? i - 1 : -1,
        cx < w - 1 ? i + 1 : -1,
        cy > 0 ? i - w : -1,
        cy < h - 1 ? i + w : -1
      ];
      for (const j of nbs) {
        if (j < 0 || wall[j] || regionOf[j] !== -1) continue;
        regionOf[j] = id;
        stack.push(j);
      }
    }
    regions.push(list);
  }
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
    bulbInSeg: new Int32Array(rowSegCells.length + colSegCells.length).fill(-1),
    regionOf,
    regions
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
  /** 数字墙：已放灯泡数 */
  clueBulbs;
  /** 每个墙界区域已放灯泡数 */
  regionBulbs;
  /** 照亮位图 */
  lit;
  /** 数字墙索引列表 */
  clueWalls;
  /** P7 反证排除的去重标记（按数字墙 stamp） */
  r4Seen;
  r4Stamp = 0;
  /** P7 是否启用（超大棋盘跳过以控制单节点开销） */
  exhaustOk;
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
    this.regionBulbs = new Int32Array(this.m.regions.length).fill(0);
    this.lit = new Uint8Array(total).fill(0);
    this.clueWalls = [];
    for (let i = 0; i < total; i++) {
      if (this.m.clue[i] !== null) this.clueWalls.push(i);
    }
    this.r4Seen = new Uint8Array(total);
    this.exhaustOk = this.m.whites.length <= 900;
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
      for (const w of this.adjWallsOf(i)) this.clueBulbs[w]++;
      this.regionBulbs[this.m.regionOf[i]]++;
      for (const j of entry.litAdded) {
        if (this.cells[j] === 0 /* Unknown */) this.assign(j, 2 /* Mark */);
      }
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
        for (const w of this.adjWallsOf(e.i)) this.clueBulbs[w]--;
        this.regionBulbs[this.m.regionOf[e.i]]--;
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
          continue;
        }
        const cands = [];
        for (const j of adj) {
          if (this.cells[j] === 0 /* Unknown */ && this.placeBulbOk(j)) cands.push(j);
        }
        if (cands.length < need) return false;
        if (cands.length === need) {
          for (const j of cands) {
            if (this.cells[j] !== 0 /* Unknown */) continue;
            if (!this.placeBulbOk(j)) return false;
            this.assign(j, 1 /* Bulb */);
            changed = true;
          }
          continue;
        }
      }
      for (let r = 0; r < this.m.regions.length; r++) {
        if (this.regionBulbs[r] > 0) continue;
        let cnt = 0;
        let only = -1;
        for (const i of this.m.regions[r]) {
          if (this.cells[i] !== 0 /* Unknown */ || !this.placeBulbOk(i)) continue;
          cnt++;
          only = i;
          if (cnt > 1) break;
        }
        if (cnt === 0) return false;
        if (cnt === 1) {
          if (!this.placeBulbOk(only)) return false;
          this.assign(only, 1 /* Bulb */);
          changed = true;
        }
      }
      if (this.exhaustOk) for (const w of this.clueWalls) {
        const need = this.m.clue[w] - this.clueBulbs[w];
        if (need <= 0) continue;
        const adj = this.m.clueAdj[w] ?? [];
        const cands = [];
        for (const j of adj) {
          if (this.cells[j] === 0 /* Unknown */ && this.placeBulbOk(j)) cands.push(j);
        }
        if (cands.length <= need) continue;
        const near = this.clueBulbs[w];
        const stamp = ++this.r4Stamp;
        const candSet = new Set(cands);
        let hitWall = false;
        const tryX = (x) => {
          if (hitWall) return;
          if (this.r4Seen[x] === stamp) return;
          this.r4Seen[x] = stamp;
          if (this.cells[x] !== 0 /* Unknown */ || !this.placeBulbOk(x)) return;
          let hit = 0;
          for (const j of cands) {
            if (this.m.rowSeg[j] === this.m.rowSeg[x] || this.m.colSeg[j] === this.m.colSeg[x]) hit++;
          }
          if (hit === 0) return;
          const adjX = candSet.has(x) ? 1 : 0;
          if (near + adjX + cands.length - hit < this.m.clue[w]) {
            this.assign(x, 2 /* Mark */);
            changed = true;
            hitWall = true;
          }
        };
        for (const j of cands) {
          for (const x of this.m.rowSegCells[this.m.rowSeg[j]]) tryX(x);
          if (hitWall) break;
          for (const x of this.m.colSegCells[this.m.colSeg[j]]) tryX(x);
          if (hitWall) break;
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
function solvePuzzle(puzzle, opts = {}) {
  const s = new Searcher(puzzle, opts);
  let solution = null;
  s.search((cells) => {
    solution = s.toState(cells);
    return true;
  });
  return { solved: solution !== null, solution, nodes: s.nodes, timedOut: s.timedOut };
}
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

// src/logic.ts
var RULE_LABELS = {
  1: "\u6570\u5B57\u5899\u706F\u6CE1\u6570\u5DF2\u591F\uFF0C\u5176\u4F59\u90BB\u683C\u6392\u9664",
  2: "\u6570\u5B57\u5899\u8FD8\u5DEE\u7684\u706F\u6CE1\u6570\u53EA\u5269\u8FD9\u4E9B\u4F4D\u7F6E",
  3: "\u8BE5\u683C\u53EA\u80FD\u7531\u8FD9\u4E00\u4E2A\u4F4D\u7F6E\u7167\u4EAE",
  4: "\u653E\u706F\u6CE1\u4F1A\u8BA9\u8FD9\u9762\u6570\u5B57\u5899\u51D1\u4E0D\u591F\u706F\u6CE1",
  5: "\u5899\u754C\u533A\u57DF\u5FC5\u6709\u70B9\u5149\u6E90\uFF0C\u53EA\u5269\u8FD9\u4E00\u4E2A\u53EF\u653E\u4F4D\u7F6E"
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
    if (v === 1 /* Bulb */ && lit[i]) return false;
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
    for (let r = 0; r < model.regions.length; r++) {
      const cellsIn = model.regions[r];
      let hasBulb = false;
      for (const i of cellsIn) {
        if (cells[i] === 1 /* Bulb */) {
          hasBulb = true;
          break;
        }
      }
      if (hasBulb) continue;
      let only = -1;
      let cnt = 0;
      for (const i of cellsIn) {
        if (cells[i] !== 0 /* Unknown */ || lit[i]) continue;
        cnt++;
        only = i;
        if (cnt > 1) break;
      }
      if (cnt === 1 && setCell(only, 1 /* Bulb */, 5, `\uFF08\u533A\u57DF ${r} \u552F\u4E00\u53EF\u653E\u4F4D\u7F6E\uFF09`)) changed = true;
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

// scripts/check.mts
var fail = 0;
var totalSteps = 0;
var totalSolveNodes = 0;
var totalCountNodes = 0;
var logicComplete = 0;
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
  if (!bad) {
    const plan = planLogicSolve(p);
    const solve = solvePuzzle(p, { maxNodes: 2e6, timeBudgetMs: 3e4 });
    totalSteps += plan.steps.length;
    totalSolveNodes += solve.nodes;
    totalCountNodes += r.nodes;
    if (plan.complete) logicComplete++;
    console.log(
      `  \u2713 \u53C2\u8003\u89E3\u5408\u6CD5 \xB7 \u552F\u4E00\u89E3 \xB7 \u5899 ${walls} \xB7 \u706F\u6CE1 ${bulbs} \xB7 \u903B\u8F91 ${plan.steps.length} \u6B65\uFF08complete=${plan.complete}\uFF09 \xB7 \u6C42\u89E3 ${solve.nodes} \u8282\u70B9 \xB7 \u552F\u4E00\u6027 ${r.nodes} \u8282\u70B9`
    );
  }
}
console.log("");
console.log(
  `\u7EDF\u8BA1\uFF1A\u903B\u8F91 complete ${logicComplete}/${puzzles.length} \xB7 \u903B\u8F91\u5171 ${totalSteps} \u6B65 \xB7 \u6C42\u89E3\u5408\u8BA1 ${totalSolveNodes} \u8282\u70B9 \xB7 \u552F\u4E00\u6027\u5408\u8BA1 ${totalCountNodes} \u8282\u70B9`
);
if (fail) {
  console.log(`\u5931\u8D25 ${fail} \u9879`);
  process.exit(1);
}
console.log("\u5168\u90E8\u901A\u8FC7");
