import type { ClueCell, GameState, Puzzle } from './types'
import { WALL } from './types'
import { createEmptyState } from './state'
import { parseCells } from './library'
import { RAW_PUZZLES, type RawPuzzle } from './puzzles-data'

/** 参考解：'o' = 灯泡，'.' = 空地/墙 */
export function solutionBulbs(solution: string): boolean[] {
  return [...solution].map((ch) => ch === 'o')
}

function toPuzzle(r: RawPuzzle): Puzzle {
  return {
    id: r.id,
    name: r.name,
    width: r.width,
    height: r.height,
    difficulty: r.difficulty,
    cells: parseCells(r.cells),
    solution: r.solution,
  }
}

/** 静态题库（import 即用，无运行时生成） */
export const puzzles: Puzzle[] = RAW_PUZZLES.map(toPuzzle)

const solutions = new Map<string, string>()
for (const r of RAW_PUZZLES) {
  if (r.solution) solutions.set(r.id, r.solution)
}

export function getPuzzle(id: string): Puzzle | undefined {
  return puzzles.find((p) => p.id === id)
}

/** 参考解串（'o' = 灯泡）；没有返回 null */
export function getReferenceSolution(id: string): string | null {
  return solutions.get(id) ?? null
}

/** 由参考解构造 GameState（灯泡 + 其余空地 ×） */
export function stateFromReference(puzzle: Puzzle): GameState | null {
  const sol = puzzle.solution
  if (!sol) return null
  const st = createEmptyState(puzzle)
  const bulbs = solutionBulbs(sol)
  for (let i = 0; i < bulbs.length; i++) {
    const c: ClueCell = puzzle.cells[i] ?? null
    if (c !== null) continue // 墙
    st.cells[i] = bulbs[i] ? 1 : 2
  }
  return st
}

export function randomPuzzle(avoidId?: string): Puzzle {
  const pool = avoidId ? puzzles.filter((p) => p.id !== avoidId) : puzzles
  const list = pool.length ? pool : puzzles
  return list[Math.floor(Math.random() * list.length)]!
}

export function wallCount(p: Puzzle): number {
  return p.cells.filter((c) => c !== null && c !== undefined).length
}

export { WALL }
