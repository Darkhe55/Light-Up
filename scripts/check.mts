/**
 * 题库审计：校验 src/puzzles-data.ts 里每道题
 *   1. 串长度与题面尺寸吻合
 *   2. 参考解通过 validate（数字满足 + 无互照 + 全照亮）
 *   3. 解唯一（countSolutions === 1）
 *
 * 用法：npm run check
 */
import { puzzles } from '../src/puzzles.ts'
import { countSolutions } from '../src/solver.ts'
import { stateFromReference } from '../src/puzzles.ts'
import { validate } from '../src/validate.ts'
import { isWall } from '../src/state.ts'

let fail = 0
const failIf = (cond: boolean, msg: string) => {
  if (cond) {
    console.log(`  ✗ ${msg}`)
    fail++
    return true
  }
  return false
}

console.log(`共 ${puzzles.length} 道题\n`)

for (const p of puzzles) {
  const w = p.width
  const h = p.height
  console.log(`${p.id}  ${w}×${h}  ${p.difficulty}`)

  let bad = false
  bad ||= failIf(p.cells.length !== w * h, `cells 长度 ${p.cells.length} ≠ ${w * h}`)
  bad ||= failIf(!p.solution || p.solution.length !== w * h, 'solution 长度不对')
  if (bad) continue

  let walls = 0
  let bulbs = 0
  for (let i = 0; i < w * h; i++) {
    if (isWall(p, i)) walls++
    if (p.solution![i] === 'o') bulbs++
  }
  bad ||= failIf(walls === 0, '没有墙')
  bad ||= failIf(bulbs === 0, '参考解没有灯泡')

  // 参考解合法性
  const st = stateFromReference(p)!
  const v = validate(st, p)
  bad ||= failIf(!v.solved, `参考解不合法：${JSON.stringify(v).slice(0, 200)}`)

  const r = countSolutions(p, 2, { maxNodes: 2_000_000, timeBudgetMs: 30_000 })
  bad ||= failIf(r.timedOut, '唯一解校验超时')
  bad ||= failIf(r.count !== 1, `解数 = ${r.count}（应为 1）`)

  if (!bad) console.log(`  ✓ 参考解合法 · 唯一解 · 墙 ${walls} · 灯泡 ${bulbs}`)
}

console.log('')
if (fail) {
  console.log(`失败 ${fail} 项`)
  process.exit(1)
}
console.log('全部通过')
