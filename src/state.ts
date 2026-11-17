import type { CellState, GameState, Move, Puzzle } from './types.ts'
import { CellState as CS, WALL } from './types.ts'

/* ———————————————————— 索引与邻格 ———————————————————— */

export function cellIndex(w: number, cx: number, cy: number): number {
  return cy * w + cx
}

export function inBoard(w: number, h: number, cx: number, cy: number): boolean {
  return cx >= 0 && cy >= 0 && cx < w && cy < h
}

/** 四邻（正交） */
export function neighbors4(w: number, h: number, cx: number, cy: number) {
  const out: Array<{ cx: number; cy: number }> = []
  if (cx > 0) out.push({ cx: cx - 1, cy })
  if (cx < w - 1) out.push({ cx: cx + 1, cy })
  if (cy > 0) out.push({ cx, cy: cy - 1 })
  if (cy < h - 1) out.push({ cx, cy: cy + 1 })
  return out
}

/* ———————————————————— 题面查询 ———————————————————— */

export function isWall(puzzle: Puzzle, index: number): boolean {
  return puzzle.cells[index] !== null && puzzle.cells[index] !== undefined
}

/** 数字墙的数字；空地/无数字墙返回 null */
export function clueAt(puzzle: Puzzle, index: number): number | null {
  const c = puzzle.cells[index]
  if (c === null || c === undefined || c === WALL) return null
  return c
}

/** 数字墙位置（含四邻空地索引） */
export function clueWallPositions(puzzle: Puzzle) {
  const out: Array<{ cx: number; cy: number; index: number; clue: number; adj: number[] }> = []
  const w = puzzle.width
  const h = puzzle.height
  for (let cy = 0; cy < h; cy++) {
    for (let cx = 0; cx < w; cx++) {
      const index = cellIndex(w, cx, cy)
      const clue = clueAt(puzzle, index)
      if (clue === null) continue
      const adj = neighbors4(w, h, cx, cy)
        .map((nb) => cellIndex(w, nb.cx, nb.cy))
        .filter((j) => !isWall(puzzle, j))
      out.push({ cx, cy, index, clue, adj })
    }
  }
  return out
}

/* ———————————————————— 段（行/列连续空地） ———————————————————— */

export interface BoardModel {
  w: number
  h: number
  /** 墙位图 */
  wall: boolean[]
  /** 数字墙数字（无数字为 null） */
  clue: Array<number | null>
  /** 每个格子的行段号 / 列段号（墙格为 -1） */
  rowSeg: Int32Array
  colSeg: Int32Array
  /** 行段格子列表 / 列段格子列表 */
  rowSegCells: number[][]
  colSegCells: number[][]
  /** 数字墙 → 四邻空地 */
  clueAdj: number[][]
  /** 空地索引（row-major） */
  whites: number[]
  /** 灯泡所在段 → 灯泡格（求解器用，-1 = 无） */
  bulbInSeg: Int32Array
  /** 空地连通区域编号（被墙/边界分割；墙格 -1） */
  regionOf: Int32Array
  /** 每个区域的空地列表 */
  regions: number[][]
}

const modelCache = new WeakMap<Puzzle, BoardModel>()

/** 按题面构建（带缓存）段结构；求解器/校验/渲染共用 */
export function buildModel(puzzle: Puzzle): BoardModel {
  const cached = modelCache.get(puzzle)
  if (cached) return cached

  const w = puzzle.width
  const h = puzzle.height
  const wall = new Array<boolean>(w * h).fill(false)
  const clue: Array<number | null> = new Array(w * h).fill(null)
  for (let i = 0; i < w * h; i++) {
    const c = puzzle.cells[i]
    if (c === null || c === undefined) continue
    wall[i] = true
    if (c !== WALL) clue[i] = c
  }

  const rowSeg = new Int32Array(w * h).fill(-1)
  const colSeg = new Int32Array(w * h).fill(-1)
  const rowSegCells: number[][] = []
  const colSegCells: number[][] = []

  // 行段：从左到右，遇墙断开
  for (let cy = 0; cy < h; cy++) {
    let seg = -1
    for (let cx = 0; cx < w; cx++) {
      const i = cellIndex(w, cx, cy)
      if (wall[i]) {
        seg = -1
        continue
      }
      if (seg < 0) {
        seg = rowSegCells.length
        rowSegCells.push([])
      }
      rowSeg[i] = seg
      rowSegCells[seg]!.push(i)
    }
  }
  // 列段：从上到下，遇墙断开
  for (let cx = 0; cx < w; cx++) {
    let seg = -1
    for (let cy = 0; cy < h; cy++) {
      const i = cellIndex(w, cx, cy)
      if (wall[i]) {
        seg = -1
        continue
      }
      if (seg < 0) {
        seg = colSegCells.length
        colSegCells.push([])
      }
      colSeg[i] = seg
      colSegCells[seg]!.push(i)
    }
  }

  const clueAdj: number[][] = []
  for (const cw of clueWallPositions(puzzle)) {
    clueAdj[cw.index] = cw.adj
  }

  const whites: number[] = []
  for (let i = 0; i < w * h; i++) if (!wall[i]) whites.push(i)

  // 连通区域：墙与边界把空地分割成互不影响的块。
  // 任一格的照明只能来自同一行段/列段的灯泡，而同一行段/列段必然同区，
  // 因此「每个区域至少要有 1 个灯泡」是必然结论（用于区域规则）。
  const regionOf = new Int32Array(w * h).fill(-1)
  const regions: number[][] = []
  for (let start = 0; start < w * h; start++) {
    if (wall[start] || regionOf[start] !== -1) continue
    const id = regions.length
    const list: number[] = []
    regionOf[start] = id
    const stack = [start]
    while (stack.length) {
      const i = stack.pop()!
      list.push(i)
      const cx = i % w
      const cy = Math.floor(i / w)
      const nbs = [
        cx > 0 ? i - 1 : -1,
        cx < w - 1 ? i + 1 : -1,
        cy > 0 ? i - w : -1,
        cy < h - 1 ? i + w : -1,
      ]
      for (const j of nbs) {
        if (j < 0 || wall[j] || regionOf[j] !== -1) continue
        regionOf[j] = id
        stack.push(j)
      }
    }
    regions.push(list)
  }

  const model: BoardModel = {
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
    regions,
  }
  modelCache.set(puzzle, model)
  return model
}

/* ———————————————————— 状态读写 ———————————————————— */

export function createEmptyState(puzzle: Puzzle): GameState {
  return {
    puzzleId: puzzle.id,
    width: puzzle.width,
    height: puzzle.height,
    cells: new Array<CellState>(puzzle.width * puzzle.height).fill(CS.Unknown),
  }
}

export function cellValue(state: GameState, index: number): CellState {
  return state.cells[index] ?? CS.Unknown
}

export function setCell(state: GameState, index: number, value: CellState): void {
  state.cells[index] = value
}

/* ———————————————————— 点击动作 ———————————————————— */

/** 一次落子动作：放灯泡 / 标 × / 取消 */
export type PaintAction = 'bulb' | 'mark' | 'clear'

/** 左键循环：空 → 灯泡 → × → 空 */
export function leftAction(current: CellState): PaintAction {
  if (current === CS.Unknown) return 'bulb'
  if (current === CS.Bulb) return 'mark'
  return 'clear'
}

/** 右键：直接 × / 取消 */
export function rightAction(current: CellState): PaintAction {
  return current === CS.Mark ? 'clear' : 'mark'
}

export function actionValue(action: PaintAction): CellState {
  if (action === 'bulb') return CS.Bulb
  if (action === 'mark') return CS.Mark
  return CS.Unknown
}

export function applyMove(state: GameState, move: Move): void {
  setCell(state, move.index, move.to)
}

export function invertMove(move: Move): Move {
  return { ...move, from: move.to, to: move.from }
}

export function cloneState(state: GameState): GameState {
  return {
    puzzleId: state.puzzleId,
    width: state.width,
    height: state.height,
    cells: state.cells.slice(),
  }
}

/* ———————————————————— 存档 ———————————————————— */

export function serializeState(state: GameState) {
  return {
    version: 1 as const,
    puzzleId: state.puzzleId,
    width: state.width,
    height: state.height,
    cells: state.cells.map((c) => c as number),
    updatedAt: Date.now(),
  }
}

export function deserializeState(data: {
  version: number
  puzzleId: string
  width: number
  height: number
  cells: number[]
}): GameState {
  return {
    puzzleId: data.puzzleId,
    width: data.width,
    height: data.height,
    cells: data.cells.map((n) => n as CellState),
  }
}

/** 由参考解串（'o' = 灯泡）构造 GameState：灯泡 + 其余空地标 × */
export function stateFromSolution(puzzle: Puzzle, solution: string): GameState {
  const st = createEmptyState(puzzle)
  const m = buildModel(puzzle)
  for (let i = 0; i < m.whites.length; i++) {
    const idx = m.whites[i]!
    st.cells[idx] = solution[idx] === 'o' ? CS.Bulb : CS.Mark
  }
  return st
}
