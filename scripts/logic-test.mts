/**
 * 逻辑解题引擎自检（scripts/logic-test.mts，npm run logic-test）
 *
 * 校验重点（对应用户要求的改动）：
 *   1. **不把亮格打叉**：每一步标 × 的格，在当时必须未被照亮
 *   2. 不在亮格/叉格上放灯泡：灯泡只能落在「未定且未被照亮」的候选位
 *   3. 任何时刻：无灯泡互照、无数字墙超额
 *   4. 终态灯泡 ⊆ 参考解灯泡；complete 时与参考解完全一致且盘面已解出
 *   5. **标记可靠**：每一步打叉的格都不是参考解里的灯泡（R4 假放排除也不能排错）
 *
 * 每道题跑两种起点：空盘、半满盘（参考解灯泡隔一个放一个的合法中间态）。
 * 同时统计「亮格但保持未打叉」的格数——即相对旧行为省掉的操作。
 * 末尾用合成题定向验证：R4（5×5 单墙数字 3 打叉四个对角格）、
 * R5（0 墙把同区两格打叉后，区域只剩唯一可放位置 → 强制灯泡）。
 */
import { puzzles, stateFromReference } from '../src/puzzles.ts'
import { planLogicSolve } from '../src/logic.ts'
import { litGrid, validate } from '../src/validate.ts'
import type { CellState, ClueCell, GameState, Puzzle } from '../src/types.ts'
import { CellState as CS } from '../src/types.ts'

let fail = 0
const failIf = (cond: boolean, msg: string) => {
  if (cond) {
    console.log(`  ✗ ${msg}`)
    fail++
    return true
  }
  return false
}

const wrap = (p: (typeof puzzles)[number], cells: CellState[]): GameState => ({
  puzzleId: p.id,
  width: p.width,
  height: p.height,
  cells,
})

console.log(`逻辑引擎自检：${puzzles.length} 道题 × 2 种起点\n`)

for (const p of puzzles) {
  const ref = stateFromReference(p)!
  const refBulbs = new Set(
    ref.cells.map((v, i) => (v === CS.Bulb ? i : -1)).filter((i) => i >= 0),
  )
  const empty = new Array<CellState>(p.width * p.height).fill(CS.Unknown)
  // 半满起点：参考解灯泡隔一个放一个（确定性的合法中间态）
  const half = empty.slice()
  let k = 0
  for (const i of refBulbs) {
    if (k++ % 2 === 0) half[i] = CS.Bulb
  }

  for (const [label, start] of [
    ['空盘', empty],
    ['半满', half],
  ] as const) {
    const plan = planLogicSolve(p, wrap(p, start))
    const cells = start.slice()
    let markOnLit = 0
    let bulbOnBad = 0
    let conflicts = 0
    let overs = 0
    let bulbSteps = 0
    let markSteps = 0
    let unsoundMark = 0
    const ruleHits = [0, 0, 0, 0, 0, 0]

    for (const step of plan.steps) {
      ruleHits[step.rule] = (ruleHits[step.rule] ?? 0) + 1
      const lit = litGrid(p, wrap(p, cells))
      if (step.value === CS.Mark) {
        markSteps++
        if (lit[step.index]!) markOnLit++ // 把亮格打叉 = 违反本次改动
        if (ref.cells[step.index] === CS.Bulb) unsoundMark++ // 把参考解灯泡打叉 = 不可靠
      } else {
        bulbSteps++
        if (lit[step.index]! || cells[step.index] !== CS.Unknown) bulbOnBad++
      }
      cells[step.index] = step.value
      const v = validate(wrap(p, cells), p)
      if (v.conflictBulbs.length) conflicts++
      if (v.overWalls.length) overs++
    }

    const litEnd = litGrid(p, wrap(p, cells))
    const finalV = validate(wrap(p, cells), p)
    const finalBulbs = new Set(
      cells.map((v, i) => (v === CS.Bulb ? i : -1)).filter((i) => i >= 0),
    )
    const notInRef = [...finalBulbs].filter((i) => !refBulbs.has(i))
    const litUnknown = cells.filter((v, i) => v === CS.Unknown && litEnd[i]!).length

    let bad = false
    bad ||= failIf(markOnLit > 0, `${label}：${markOnLit} 次把亮格打叉`)
    bad ||= failIf(bulbOnBad > 0, `${label}：${bulbOnBad} 次在亮格/叉格上放灯泡`)
    bad ||= failIf(conflicts > 0, `${label}：${conflicts} 步后出现灯泡互照`)
    bad ||= failIf(overs > 0, `${label}：${overs} 步后出现数字墙超额`)
    bad ||= failIf(notInRef.length > 0, `${label}：终态放了 ${notInRef.length} 个非参考解灯泡`)
    bad ||= failIf(unsoundMark > 0, `${label}：${unsoundMark} 次把参考解灯泡打叉（标记不可靠）`)
    if (plan.complete) {
      bad ||= failIf(!finalV.solved, `${label}：complete 但盘面未解出`)
      bad ||= failIf(
        finalBulbs.size !== refBulbs.size,
        `${label}：complete 但灯泡数 ${finalBulbs.size} ≠ 参考解 ${refBulbs.size}`,
      )
    }
    if (!bad) {
      console.log(
        `  ✓ ${p.id} [${label}] ${plan.steps.length} 步（灯泡 ${bulbSteps} / 打叉 ${markSteps}）` +
          ` · 规则命中 R1=${ruleHits[1]} R2=${ruleHits[2]} R3=${ruleHits[3]} R4=${ruleHits[4]} R5=${ruleHits[5]}` +
          ` · 亮格未打叉 ${litUnknown} · complete=${plan.complete}${finalV.solved ? ' · 已解出' : ''}`,
      )
    }
  }
}

console.log('')

// —— 合成题：R4 假放灯泡规则定向验证 ——
// 5×5，只有 (2,2) 一面墙、数字 3。它的四个邻格都是候选；
// 四个对角格各自的行段/列段各覆盖一个候选（hit=2），放上灯泡后
// 只剩 2 个可放位 < 3 → 只能打叉；其它格 hit ≤ 1，不应被打叉。
{
  const w = 5
  const board: ClueCell[] = new Array<ClueCell>(w * w).fill(null)
  board[2 * w + 2] = 3
  const p: Puzzle = {
    id: 'synthetic-r4',
    name: '合成 · R4',
    width: w,
    height: w,
    cells: board,
    difficulty: 'custom',
  }
  const plan = planLogicSolve(p)
  const marks = plan.steps.filter((s) => s.value === CS.Mark)
  const bulbs = plan.steps.filter((s) => s.value === CS.Bulb)
  const markSet = new Set(marks.map((s) => s.index))
  // 对角格：(1,1)=6, (3,1)=8, (1,3)=16, (3,3)=18
  const diag = [1 * w + 1, 3 * w + 1, 1 * w + 3, 3 * w + 3]
  let sbad = false
  sbad ||= failIf(
    !diag.every((i) => markSet.has(i)),
    `R4 合成题：对角格未全部打叉（实际打叉 ${[...markSet].join(',')}）`,
  )
  sbad ||= failIf(
    [...markSet].some((i) => !diag.includes(i)),
    `R4 合成题：打叉了非对角格 ${[...markSet].filter((i) => !diag.includes(i)).join(',')}`,
  )
  sbad ||= failIf(marks.some((s) => s.rule !== 4), 'R4 合成题：存在非 R4 的打叉步骤')
  sbad ||= failIf(bulbs.length > 0, `R4 合成题：不应直接推出灯泡（${bulbs.length} 个）`)
  if (!sbad) {
    console.log(`  ✓ 合成题 R4：${marks.length} 个对角格全部由规则 4 打叉，无灯泡推论`)
  }
}

// —— 合成题：R5 区域必有点光源 ——
// 2×2：(0,0) 是数字 0 墙，(1,0)/(0,1) 被 0 墙强制排除，
// 剩下 (1,1) 所在区域还没有灯泡、只剩这一个可放位置 → 规则 5 放灯。
{
  const w = 2
  const board: ClueCell[] = [0, null, null, null]
  const p: Puzzle = {
    id: 'synthetic-r5',
    name: '合成 · R5',
    width: w,
    height: w,
    cells: board,
    difficulty: 'custom',
  }
  const plan = planLogicSolve(p)
  const bulb = plan.steps.find((s) => s.value === CS.Bulb)
  const rbad = failIf(!bulb || bulb.rule !== 5, 'R5 合成题：唯一可放位置未由规则 5 放灯')
  failIf(bulb?.index !== 3, `R5 合成题：放灯位置应为 (1,1)=3（实际 ${bulb?.index}）`)
  failIf(
    plan.steps.filter((s) => s.value === CS.Bulb).length !== 1,
    'R5 合成题：应恰好 1 个灯泡推论',
  )
  failIf(plan.steps.some((s) => s.rule === 4), 'R5 合成题：不应触发 R4')
  if (!rbad) console.log('  ✓ 合成题 R5：0 墙排除后区域唯一可放位置由规则 5 放灯')
}

if (fail) {
  console.log(`失败 ${fail} 项`)
  process.exit(1)
}
console.log('逻辑引擎自检全部通过')
