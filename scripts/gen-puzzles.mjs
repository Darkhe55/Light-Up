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
      for (const w of this.adjWallsOf(i)) this.clueBulbs[w]++;
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
        for (const w of this.adjWallsOf(e.i)) this.clueBulbs[w]--;
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

// scripts/gen-puzzles.mts
import { writeFileSync } from "node:fs";
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a += 1831565813;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
var SPECS = [
  { id: "starter-5x5", name: "\u5165\u95E8 \xB7 5\xD75", width: 5, height: 5, difficulty: "easy", series: "starter", seed: 20260401, density: 0.2 },
  { id: "starter-6x6", name: "\u5165\u95E8 \xB7 6\xD76", width: 6, height: 6, difficulty: "easy", series: "starter", seed: 20260402, density: 0.2 },
  { id: "starter-7x7", name: "\u5165\u95E8 \xB7 7\xD77", width: 7, height: 7, difficulty: "easy", series: "starter", seed: 20260403, density: 0.19 },
  { id: "classic-8x8-A", name: "\u7ECF\u5178 \xB7 8\xD78 A", width: 8, height: 8, difficulty: "medium", series: "classic", seed: 20260404, density: 0.18 },
  { id: "classic-8x8-B", name: "\u7ECF\u5178 \xB7 8\xD78 B", width: 8, height: 8, difficulty: "medium", series: "classic", seed: 20260405, density: 0.18 },
  { id: "classic-9x9", name: "\u7ECF\u5178 \xB7 9\xD79", width: 9, height: 9, difficulty: "medium", series: "classic", seed: 20260406, density: 0.17 },
  { id: "classic-10x10", name: "\u7ECF\u5178 \xB7 10\xD710", width: 10, height: 10, difficulty: "medium", series: "classic", seed: 20260407, density: 0.17 },
  { id: "challenge-10x10-B", name: "\u6311\u6218 \xB7 10\xD710 B", width: 10, height: 10, difficulty: "hard", series: "challenge", seed: 20260408, density: 0.19 },
  { id: "challenge-12x12", name: "\u6311\u6218 \xB7 12\xD712", width: 12, height: 12, difficulty: "hard", series: "challenge", seed: 20260409, density: 0.16 }
];
function generate(spec) {
  const { width: w, height: h } = spec;
  const total = w * h;
  const t0 = Date.now();
  let kept = null;
  let nodes = 0;
  for (let attempt = 0; attempt < 500 && !kept; attempt++) {
    const rng = mulberry32(spec.seed + attempt * 7919);
    const density = Math.min(0.34, spec.density + attempt * 15e-4);
    const wall = new Array(total).fill(false);
    for (let i = 0; i < total; i++) wall[i] = rng() < density;
    const basePuzzle = {
      id: spec.id,
      name: spec.name,
      width: w,
      height: h,
      difficulty: spec.difficulty,
      cells: wall.map((x) => x ? WALL : null)
    };
    const r = solvePuzzle(basePuzzle, {
      rng,
      maxNodes: 3e5,
      timeBudgetMs: 1e4
    });
    nodes += r.nodes;
    if (!r.solved || !r.solution) continue;
    const bulbs = r.solution.cells.map((c2) => c2 === 1);
    const cells = new Array(total).fill(null);
    for (let cy = 0; cy < h; cy++) {
      for (let cx = 0; cx < w; cx++) {
        const i = cy * w + cx;
        if (!wall[i]) continue;
        let n = 0;
        if (cx > 0 && bulbs[i - 1]) n++;
        if (cx < w - 1 && bulbs[i + 1]) n++;
        if (cy > 0 && bulbs[i - w]) n++;
        if (cy < h - 1 && bulbs[i + w]) n++;
        cells[i] = n;
      }
    }
    const puzzle = { ...basePuzzle, cells };
    const c = countSolutions(puzzle, 2, { maxNodes: 2e6, timeBudgetMs: 3e4 });
    nodes += c.nodes;
    if (c.count === 1 && !c.timedOut) {
      kept = {
        cells: cells.map((x) => x === null ? "." : String(x)).join(""),
        solution: bulbs.map((b) => b ? "o" : ".").join(""),
        bulbs: bulbs.filter(Boolean).length,
        walls: wall.filter(Boolean).length
      };
    }
  }
  if (!kept) throw new Error(`${spec.id}: 500 \u6B21\u5C1D\u8BD5\u90FD\u6CA1\u9020\u51FA\u552F\u4E00\u89E3\u9898\u76EE`);
  console.log(
    `${spec.id.padEnd(18)} ${w}x${h}  \u5899=${kept.walls} \u706F\u6CE1=${kept.bulbs}  \u552F\u4E00\u89E3 \u2713  ${Date.now() - t0}ms`
  );
  return {
    id: spec.id,
    name: spec.name,
    width: w,
    height: h,
    difficulty: spec.difficulty,
    series: spec.series,
    cells: kept.cells,
    solution: kept.solution
  };
}
var rows = SPECS.map(generate);
var file = `/* \u81EA\u52A8\u751F\u6210\uFF0C\u52FF\u624B\u6539\u3002scripts/gen-puzzles.mts\uFF08npm run gen\uFF09 */
export type RawPuzzle = {
  id: string
  name: string
  width: number
  height: number
  difficulty: 'easy'|'medium'|'hard'|'custom'
  series: string
  /** \u9898\u9762\u4E32\uFF1A'.' = \u7A7A\u5730\uFF0C'#' = \u65E0\u6570\u5B57\u5899\uFF0C'0'-'4' = \u6570\u5B57\u5899 */
  cells: string
  /** \u53C2\u8003\u89E3\uFF1A'o' = \u706F\u6CE1\uFF0C'.' = \u5176\u5B83\uFF1Blength = W*H */
  solution: string
}

export const RAW_PUZZLES: RawPuzzle[] = [
${rows.map(
  (r) => `  { id: ${JSON.stringify(r.id)}, name: ${JSON.stringify(r.name)}, width: ${r.width}, height: ${r.height}, difficulty: ${JSON.stringify(r.difficulty)}, series: ${JSON.stringify(r.series)}, cells: ${JSON.stringify(r.cells)}, solution: ${JSON.stringify(r.solution)} },`
).join("\n")}
]
`;
writeFileSync(new URL("../src/puzzles-data.ts", import.meta.url), file, "utf8");
console.log("\n\u5DF2\u5199\u5165 src/puzzles-data.ts");
