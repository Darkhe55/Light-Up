import { buildModel, cellIndex, clueWallPositions, isWall, neighbors4 } from './state'
import type { GameState, Puzzle, ValidationResult } from './types'
import { CellState as CS } from './types'

/**
 * 点灯校验：
 * 1. 数字墙四邻灯泡数 === 数字
 * 2. 同一行/列段内不能有两个灯泡（互照）
 * 3. 所有空地都被照亮
 */

/** 逐格照亮位图（供渲染与校验共用） */
export function litGrid(puzzle: Puzzle, state: GameState): boolean[] {
  const m = buildModel(puzzle)
  const lit = new Array<boolean>(m.w * m.h).fill(false)

  // 行段：段内有灯泡 → 整段照亮
  for (const cells of m.rowSegCells) {
    let has = false
    for (const i of cells) if (state.cells[i] === CS.Bulb) has = true
    if (!has) continue
    for (const i of cells) lit[i] = true
  }
  // 列段
  for (const cells of m.colSegCells) {
    let has = false
    for (const i of cells) if (state.cells[i] === CS.Bulb) has = true
    if (!has) continue
    for (const i of cells) lit[i] = true
  }
  return lit
}

/** 互相照亮的灯泡格集合 */
export function conflictBulbSet(puzzle: Puzzle, state: GameState): Set<number> {
  const m = buildModel(puzzle)
  const bad = new Set<number>()
  const scan = (segments: number[][]) => {
    for (const cells of segments) {
      const bulbs = cells.filter((i) => state.cells[i] === CS.Bulb)
      if (bulbs.length > 1) for (const b of bulbs) bad.add(b)
    }
  }
  scan(m.rowSegCells)
  scan(m.colSegCells)
  return bad
}

export function validate(state: GameState, puzzle: Puzzle): ValidationResult {
  const w = puzzle.width
  const h = puzzle.height
  const overWalls: number[] = []
  const underWalls: number[] = []

  // 数字墙：四邻灯泡数
  for (const cw of clueWallPositions(puzzle)) {
    let n = 0
    for (const j of cw.adj) if (state.cells[j] === CS.Bulb) n++
    if (n > cw.clue) overWalls.push(cw.index)
    else if (n < cw.clue) underWalls.push(cw.index)
  }

  const conflicts = conflictBulbSet(puzzle, state)
  const lit = litGrid(puzzle, state)

  let bulbCount = 0
  let litCount = 0
  const darkCells: number[] = []
  for (let cy = 0; cy < h; cy++) {
    for (let cx = 0; cx < w; cx++) {
      const i = cellIndex(w, cx, cy)
      if (isWall(puzzle, i)) continue
      if (state.cells[i] === CS.Bulb) bulbCount++
      if (lit[i]) litCount++
      else darkCells.push(i)
    }
  }

  const solved =
    overWalls.length === 0 &&
    underWalls.length === 0 &&
    conflicts.size === 0 &&
    darkCells.length === 0

  return {
    overWalls,
    underWalls,
    conflictBulbs: [...conflicts],
    darkCells,
    bulbCount,
    litCount,
    solved,
  }
}

/** 数字墙当前四邻灯泡数（渲染用） */
export function bulbsNearWall(puzzle: Puzzle, state: GameState, wallIndex: number): number {
  const w = puzzle.width
  const h = puzzle.height
  const cx = wallIndex % w
  const cy = Math.floor(wallIndex / w)
  let n = 0
  for (const nb of neighbors4(w, h, cx, cy)) {
    const j = cellIndex(w, nb.cx, nb.cy)
    if (state.cells[j] === CS.Bulb) n++
  }
  return n
}
