import { buildModel, createEmptyState } from './state.ts'
import type { CellState, GameState, Puzzle } from './types.ts'
import { CellState as CS } from './types.ts'

/**
 * 点灯求解器：约束传播 + 回溯。
 *
 * 硬约束：
 *  - 同一行/列段内最多一个灯泡（互照）
 *  - 数字墙四邻灯泡数 === 数字
 *  - 所有空地都被照亮（每格的行段或列段里有灯泡）
 *
 * 传播规则（都是必然结论）：
 *  P1 放下灯泡 → 同行段/同列段其余格全部 ×
 *  P2 数字墙已满足 → 其余四邻 ×
 *  P3 数字墙「剩余需求 == 剩余未定邻格」→ 这些邻格全部放灯泡
 *  P4 未照亮格只剩一个可放灯泡的位置 → 那里放灯泡
 */

export interface SolveResult {
  solved: boolean
  solution: GameState | null
  nodes: number
  timedOut: boolean
}

export interface CountResult {
  count: number
  /** 至少达到 limit */
  capped: boolean
  nodes: number
  timedOut: boolean
  first: GameState | null
  second: GameState | null
}

export interface SearchOptions {
  maxNodes?: number
  timeBudgetMs?: number
  /** 随机化分支顺序（题库生成用） */
  rng?: () => number
}

interface TrailEntry {
  i: number
  v: CellState
  /** 这次赋值新照亮的格子（撤销时熄灭） */
  litAdded: number[]
}

class Searcher {
  readonly m: ReturnType<typeof buildModel>
  private readonly puzzle: Puzzle
  private readonly cells: CellState[]
  /** 行段/列段里的灯泡格（-1 = 无）；列段号整体偏移 rowCount */
  private readonly segBulb: Int32Array
  private readonly rowCount: number
  /** 数字墙：已放灯泡数 / 仍未定邻格数 */
  private readonly clueBulbs: Int32Array
  private readonly clueFree: Int32Array
  /** 照亮位图 */
  private readonly lit: Uint8Array
  /** 数字墙索引列表 */
  private readonly clueWalls: number[]
  private readonly trail: TrailEntry[] = []
  private readonly maxNodes: number
  private readonly deadline: number
  private readonly rng: (() => number) | null
  nodes = 0
  timedOut = false

  constructor(puzzle: Puzzle, opts: SearchOptions = {}) {
    this.puzzle = puzzle
    this.m = buildModel(puzzle)
    const total = this.m.w * this.m.h
    this.cells = new Array<CellState>(total).fill(CS.Unknown)
    this.rowCount = this.m.rowSegCells.length
    this.segBulb = new Int32Array(this.rowCount + this.m.colSegCells.length).fill(-1)
    this.clueBulbs = new Int32Array(total).fill(0)
    this.clueFree = new Int32Array(total).fill(0)
    this.lit = new Uint8Array(total).fill(0)
    this.clueWalls = []
    for (let i = 0; i < total; i++) {
      if (this.m.clue[i] !== null) this.clueWalls.push(i)
    }
    // 未定邻格数初值 = 四邻空地数
    for (const w of this.clueWalls) {
      this.clueFree[w] = this.m.clueAdj[w]?.length ?? 0
    }
    this.maxNodes = opts.maxNodes ?? 400_000
    this.deadline = opts.timeBudgetMs ? Date.now() + opts.timeBudgetMs : 0
    this.rng = opts.rng ?? null
  }

  private colSegId(i: number): number {
    return this.rowCount + this.m.colSeg[i]!
  }

  private placeBulbOk(i: number): boolean {
    return this.segBulb[this.m.rowSeg[i]!] === -1 && this.segBulb[this.colSegId(i)] === -1
  }

  private assign(i: number, v: CellState): void {
    this.cells[i] = v
    const entry: TrailEntry = { i, v, litAdded: [] }
    this.trail.push(entry)
    if (v === CS.Bulb) {
      const rs = this.m.rowSeg[i]!
      const cs = this.colSegId(i)
      this.segBulb[rs] = i
      this.segBulb[cs] = i
      for (const j of this.m.rowSegCells[rs]!) {
        if (!this.lit[j]) {
          this.lit[j] = 1
          entry.litAdded.push(j)
        }
      }
      for (const j of this.m.colSegCells[cs - this.rowCount]!) {
        if (!this.lit[j]) {
          this.lit[j] = 1
          entry.litAdded.push(j)
        }
      }
      // 灯泡影响相邻数字墙的「已放数」；同时不再算作「未定邻格」
      for (const w of this.adjWallsOf(i)) {
        this.clueBulbs[w]!++
        this.clueFree[w]!--
      }
    } else if (v === CS.Mark) {
      for (const w of this.adjWallsOf(i)) this.clueFree[w]!--
    }
  }

  /** 空地 i 四邻的数字墙索引 */
  private adjWallsOf(i: number): number[] {
    const w = this.m.w
    const cx = i % w
    const cy = Math.floor(i / w)
    const out: number[] = []
    if (cx > 0) {
      const j = i - 1
      if (this.m.clue[j] !== null) out.push(j)
    }
    if (cx < w - 1) {
      const j = i + 1
      if (this.m.clue[j] !== null) out.push(j)
    }
    if (cy > 0) {
      const j = i - w
      if (this.m.clue[j] !== null) out.push(j)
    }
    if (cy < this.m.h - 1) {
      const j = i + w
      if (this.m.clue[j] !== null) out.push(j)
    }
    return out
  }

  private undoTo(mark: number): void {
    while (this.trail.length > mark) {
      const e = this.trail.pop()!
      this.cells[e.i] = CS.Unknown
      if (e.v === CS.Bulb) {
        const rs = this.m.rowSeg[e.i]!
        const cs = this.colSegId(e.i)
        if (this.segBulb[rs] === e.i) this.segBulb[rs] = -1
        if (this.segBulb[cs] === e.i) this.segBulb[cs] = -1
        for (const j of e.litAdded) this.lit[j] = 0
        for (const w of this.adjWallsOf(e.i)) {
          this.clueBulbs[w]!--
          this.clueFree[w]!++
        }
      } else if (e.v === CS.Mark) {
        for (const w of this.adjWallsOf(e.i)) this.clueFree[w]!++
      }
    }
  }

  /** 传播到不动点；矛盾返回 false（状态已回滚到进入前） */
  private propagate(): boolean {
    for (;;) {
      let changed = false

      // 数字墙
      for (const w of this.clueWalls) {
        const need = this.m.clue[w]! - this.clueBulbs[w]!
        if (need < 0) return false
        const adj = this.m.clueAdj[w] ?? []
        if (need === 0) {
          for (const j of adj) {
            if (this.cells[j] === CS.Unknown) {
              this.assign(j, CS.Mark)
              changed = true
            }
          }
        } else {
          const free = this.clueFree[w]!
          if (free < need) return false
          if (free === need) {
            for (const j of adj) {
              if (this.cells[j] !== CS.Unknown) continue
              if (!this.placeBulbOk(j)) return false
              this.assign(j, CS.Bulb)
              changed = true
            }
          }
        }
      }

      // 照亮：任何未被照亮的格子（含已标 × 的）都必须被行/列段里的灯泡照亮
      for (const i of this.m.whites) {
        if (this.lit[i]) continue
        let cand = -1
        let count = 0
        for (const j of this.m.rowSegCells[this.m.rowSeg[i]!]!) {
          if (this.cells[j] === CS.Unknown && this.placeBulbOk(j)) {
            count++
            cand = j
            if (count > 1) break
          }
        }
        if (count <= 1) {
          for (const j of this.m.colSegCells[this.m.colSeg[i]!]!) {
            if (this.cells[j] === CS.Unknown && this.placeBulbOk(j)) {
              count++
              cand = j
              if (count > 1) break
            }
          }
        }
        if (count === 0) return false
        if (count === 1) {
          this.assign(cand, CS.Bulb)
          changed = true
        }
      }

      if (!changed) return true
    }
  }

  /** 选一个未定格分支；-1 = 全部已定 */
  private pickBranch(): number {
    // 1) 还没满足的数字墙的未定邻格
    for (const w of this.clueWalls) {
      if (this.clueBulbs[w]! >= this.m.clue[w]!) continue
      for (const j of this.m.clueAdj[w] ?? []) {
        if (this.cells[j] === CS.Unknown) return j
      }
    }
    // 2) 未照亮的未定格
    for (const i of this.m.whites) {
      if (this.cells[i] === CS.Unknown && !this.lit[i]) return i
    }
    // 3) 任意未定格
    for (const i of this.m.whites) {
      if (this.cells[i] === CS.Unknown) return i
    }
    return -1
  }

  private checkBudget(): boolean {
    if (this.nodes > this.maxNodes) {
      this.timedOut = true
      return false
    }
    if (this.deadline && (this.nodes & 2047) === 0 && Date.now() > this.deadline) {
      this.timedOut = true
      return false
    }
    return true
  }

  search(onFound: (cells: CellState[]) => boolean): boolean {
    const dfs = (): boolean => {
      this.nodes++
      if (!this.checkBudget()) return true
      const mark = this.trail.length
      if (!this.propagate()) {
        this.undoTo(mark)
        return false
      }
      const i = this.pickBranch()
      if (i < 0) return onFound(this.cells.slice())

      let order: CellState[]
      if (this.rng && this.rng() < 0.5) order = [CS.Mark, CS.Bulb]
      else order = [CS.Bulb, CS.Mark]
      for (const v of order) {
        if (v === CS.Bulb && !this.placeBulbOk(i)) continue
        this.assign(i, v)
        if (dfs()) return true
        this.undoTo(mark)
      }
      this.undoTo(mark)
      return false
    }
    return dfs()
  }

  toState(cells: CellState[]): GameState {
    const st = createEmptyState(this.puzzle)
    for (let i = 0; i < cells.length; i++) st.cells[i] = cells[i]!
    return st
  }

  /** 格子总数 */
  cellsLength(): number {
    return this.m.w * this.m.h
  }
}

/** 求解一个解 */
export function solvePuzzle(puzzle: Puzzle, opts: SearchOptions = {}): SolveResult {
  const s = new Searcher(puzzle, opts)
  let solution: GameState | null = null
  s.search((cells) => {
    solution = s.toState(cells)
    return true
  })
  return { solved: solution !== null, solution, nodes: s.nodes, timedOut: s.timedOut }
}

/** 统计解的个数（上限 limit） */
export function countSolutions(
  puzzle: Puzzle,
  limit = 2,
  opts: SearchOptions = {},
): CountResult {
  const s = new Searcher(puzzle, opts)
  let count = 0
  let first: GameState | null = null
  let second: GameState | null = null
  s.search((cells) => {
    count++
    if (!first) first = s.toState(cells)
    else if (!second) second = s.toState(cells)
    return count >= limit
  })
  return {
    count,
    capped: count >= limit,
    nodes: s.nodes,
    timedOut: s.timedOut,
    first,
    second,
  }
}

/**
 * 提示：找出「所有解都一致、且与当前盘面不同」的第一格。
 * 枚举上限 solutions 个解；解不一致时返回 null（调用方自行处理）。
 */
export function consistentCell(
  puzzle: Puzzle,
  state: GameState,
  opts: SearchOptions & { solutions?: number } = {},
): { index: number; value: CellState } | null {
  const want = Math.max(2, opts.solutions ?? 8)
  const s = new Searcher(puzzle, { ...opts, maxNodes: opts.maxNodes ?? 400_000 })
  const sols: CellState[][] = []
  s.search((cells) => {
    sols.push(cells)
    return sols.length >= want
  })
  if (!sols.length || s.timedOut) return null
  for (let i = 0; i < s.cellsLength(); i++) {
    const v = sols[0]![i]!
    if (sols.some((sol) => sol[i] !== v)) continue
    if (state.cells[i] === v) continue
    return { index: i, value: v }
  }
  return null
}
