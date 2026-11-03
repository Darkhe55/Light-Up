/**
 * 一次性生成静态题库 → src/puzzles-data.ts
 * 用法：npm run gen
 *
 * 流程（每道题）：
 *   1. 随机撒墙（给定密度，尝试次数越多密度略升，提高约束）
 *   2. 用求解器（随机分支）找一组合法摆放：无互照 + 全照亮
 *   3. 由摆放结果推导每个墙的数字（四邻灯泡数）
 *   4. 用 countSolutions 校验唯一解，不唯一就换种子重来
 */
import { countSolutions, solvePuzzle } from '../src/solver.ts'
import type { Puzzle } from '../src/types.ts'
import { WALL } from '../src/types.ts'
import { writeFileSync } from 'node:fs'

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a += 0x6d2b79f5
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Spec {
  id: string
  name: string
  width: number
  height: number
  difficulty: 'easy' | 'medium' | 'hard'
  series: string
  seed: number
  /** 墙密度基准 */
  density: number
}

const SPECS: Spec[] = [
  { id: 'starter-5x5', name: '入门 · 5×5', width: 5, height: 5, difficulty: 'easy', series: 'starter', seed: 20260401, density: 0.2 },
  { id: 'starter-6x6', name: '入门 · 6×6', width: 6, height: 6, difficulty: 'easy', series: 'starter', seed: 20260402, density: 0.2 },
  { id: 'starter-7x7', name: '入门 · 7×7', width: 7, height: 7, difficulty: 'easy', series: 'starter', seed: 20260403, density: 0.19 },
  { id: 'classic-8x8-A', name: '经典 · 8×8 A', width: 8, height: 8, difficulty: 'medium', series: 'classic', seed: 20260404, density: 0.18 },
  { id: 'classic-8x8-B', name: '经典 · 8×8 B', width: 8, height: 8, difficulty: 'medium', series: 'classic', seed: 20260405, density: 0.18 },
  { id: 'classic-9x9', name: '经典 · 9×9', width: 9, height: 9, difficulty: 'medium', series: 'classic', seed: 20260406, density: 0.17 },
  { id: 'classic-10x10', name: '经典 · 10×10', width: 10, height: 10, difficulty: 'medium', series: 'classic', seed: 20260407, density: 0.17 },
  { id: 'challenge-10x10-B', name: '挑战 · 10×10 B', width: 10, height: 10, difficulty: 'hard', series: 'challenge', seed: 20260408, density: 0.19 },
  { id: 'challenge-12x12', name: '挑战 · 12×12', width: 12, height: 12, difficulty: 'hard', series: 'challenge', seed: 20260409, density: 0.16 },
]

function generate(spec: Spec) {
  const { width: w, height: h } = spec
  const total = w * h
  const t0 = Date.now()

  let kept: { cells: string; solution: string; bulbs: number; walls: number } | null = null
  let nodes = 0

  for (let attempt = 0; attempt < 500 && !kept; attempt++) {
    const rng = mulberry32(spec.seed + attempt * 7919)
    // 尝试越多密度略升：墙多 → 数字多 → 更容易唯一
    const density = Math.min(0.34, spec.density + attempt * 0.0015)

    // 1. 随机撒墙
    const wall = new Array<boolean>(total).fill(false)
    for (let i = 0; i < total; i++) wall[i] = rng() < density

    const basePuzzle: Puzzle = {
      id: spec.id,
      name: spec.name,
      width: w,
      height: h,
      difficulty: spec.difficulty,
      cells: wall.map((x) => (x ? WALL : null)),
    }

    // 2. 找一组合法摆放（随机分支 → 不同的解）
    const r = solvePuzzle(basePuzzle, {
      rng,
      maxNodes: 300_000,
      timeBudgetMs: 10_000,
    })
    nodes += r.nodes
    if (!r.solved || !r.solution) continue

    // 3. 由摆放推导墙数字
    const bulbs = r.solution.cells.map((c) => c === 1)
    const cells: Array<number | null> = new Array(total).fill(null)
    for (let cy = 0; cy < h; cy++) {
      for (let cx = 0; cx < w; cx++) {
        const i = cy * w + cx
        if (!wall[i]) continue
        let n = 0
        if (cx > 0 && bulbs[i - 1]) n++
        if (cx < w - 1 && bulbs[i + 1]) n++
        if (cy > 0 && bulbs[i - w]) n++
        if (cy < h - 1 && bulbs[i + w]) n++
        cells[i] = n
      }
    }

    const puzzle: Puzzle = { ...basePuzzle, cells }

    // 4. 唯一解校验
    const c = countSolutions(puzzle, 2, { maxNodes: 2_000_000, timeBudgetMs: 30_000 })
    nodes += c.nodes
    if (c.count === 1 && !c.timedOut) {
      kept = {
        cells: cells.map((x) => (x === null ? '.' : String(x))).join(''),
        solution: bulbs.map((b) => (b ? 'o' : '.')).join(''),
        bulbs: bulbs.filter(Boolean).length,
        walls: wall.filter(Boolean).length,
      }
    }
  }

  if (!kept) throw new Error(`${spec.id}: 500 次尝试都没造出唯一解题目`)

  console.log(
    `${spec.id.padEnd(18)} ${w}x${h}  墙=${kept.walls} 灯泡=${kept.bulbs}  唯一解 ✓  ${Date.now() - t0}ms`,
  )

  return {
    id: spec.id,
    name: spec.name,
    width: w,
    height: h,
    difficulty: spec.difficulty,
    series: spec.series,
    cells: kept.cells,
    solution: kept.solution,
  }
}

const rows = SPECS.map(generate)

const file = `/* 自动生成，勿手改。scripts/gen-puzzles.mts（npm run gen） */
export type RawPuzzle = {
  id: string
  name: string
  width: number
  height: number
  difficulty: 'easy'|'medium'|'hard'|'custom'
  series: string
  /** 题面串：'.' = 空地，'#' = 无数字墙，'0'-'4' = 数字墙 */
  cells: string
  /** 参考解：'o' = 灯泡，'.' = 其它；length = W*H */
  solution: string
}

export const RAW_PUZZLES: RawPuzzle[] = [
${rows
  .map(
    (r) =>
      `  { id: ${JSON.stringify(r.id)}, name: ${JSON.stringify(r.name)}, width: ${r.width}, height: ${r.height}, difficulty: ${JSON.stringify(r.difficulty)}, series: ${JSON.stringify(r.series)}, cells: ${JSON.stringify(r.cells)}, solution: ${JSON.stringify(r.solution)} },`,
  )
  .join('\n')}
]
`

writeFileSync(new URL('../src/puzzles-data.ts', import.meta.url), file, 'utf8')
console.log('\n已写入 src/puzzles-data.ts')
