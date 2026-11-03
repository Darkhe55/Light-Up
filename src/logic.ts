import { buildModel, cellIndex, createEmptyState, clueWallPositions } from './state'
import type { CellState, GameState, LogicPlan, LogicStep, Puzzle } from './types'
import { CellState as CS } from './types'

/**
 * 点灯逻辑解题引擎：不枚举解，只根据已确定的格子推必然结论，
 * 每一步都带人类可读的理由（供 main.ts 逐条动画播放）。
 *
 * 核心原则——**亮格与打叉格同等纳入判定**：
 * 一个格「不能放灯泡」有两种完全等价的判定：打了 × 的、被照亮的
 * （被照亮说明它的同行段或同列段里已经有灯泡，自然不能再放）。
 * 因此规则只对「未定且未被照亮」的候选位下结论，
 * 已打叉/已照亮的格直接跳过，**不把亮格打叉**，省掉这些操作。
 *
 * 规则（反复跑到不动点）：
 *  R1 数字墙四邻灯泡数已等于数字（含 0）→ 其余候选邻格 ×
 *  R2 数字墙还差 N 个、候选邻格恰好 N 个 → 这些邻格全部放灯泡
 *  R3 暗格组规则（见下方 groups 的说明）
 *  R4 假放灯泡规则：某格若放灯泡，照亮范围会烧掉某面数字墙的候选格、
 *     导致那面墙凑不够灯泡数 → 该格只能打叉
 *
 * —— R3 暗格组规则 ——
 *  - 初始给每个**暗格**生成它的「可见暗格组」：行段 ∪ 列段里除自己外
 *    可见的暗格，加上自己——也就是所有**能照亮它**的位置；
 *  - 每轮执行前先**移除本格已经变亮的组**（它不再需要被照亮）；
 *  - 再根据盘面**移除剩余组里的可见亮格和打叉格**（都不能放灯泡）；
 *  - 组里只剩下一个格子 → 那个格子必定是灯泡。
 *
 * —— R4 假放灯泡规则 ——
 *  - 汇总每面「未满足且仍可满足」的数字墙的候选集；
 *  - 对每个候选格 X 假放一次灯泡：它会照亮自己行/列段里的格子，
 *    数一下会烧掉那面墙多少候选（hit）；
 *  - 若「已有灯泡 + X 自己（仅当 X 与该墙相邻）+ 剩余候选」仍小于墙数字，
 *    说明放上 X 那面墙必然凑不够 → X 只能打叉。
 */

const RULE_LABELS: Record<number, string> = {
  1: '数字墙灯泡数已够，其余邻格排除',
  2: '数字墙还差的灯泡数只剩这些位置',
  3: '该格只能由这一个位置照亮',
  4: '放灯泡会让这面数字墙凑不够灯泡',
}

function posLabel(w: number, i: number): string {
  return `(${i % w},${Math.floor(i / w)})`
}

export function planLogicSolve(puzzle: Puzzle, start?: GameState): LogicPlan {
  const model = buildModel(puzzle)
  const cells: CellState[] = start
    ? start.cells.slice()
    : createEmptyState(puzzle).cells.slice()
  // 墙格恒为 Unknown
  for (let i = 0; i < cells.length; i++) {
    if (model.wall[i]) cells[i] = CS.Unknown
  }

  // 照亮位图：增量维护（放下灯泡即点亮所在行/列段）。
  // 亮格与打叉格同等视为「不能放灯泡」，候选位 = 未定且未被照亮。
  const lit = new Uint8Array(model.w * model.h).fill(0)
  const lightUp = (i: number) => {
    for (const j of model.rowSegCells[model.rowSeg[i]!]!) lit[j] = 1
    for (const j of model.colSegCells[model.colSeg[i]!]!) lit[j] = 1
  }
  for (const i of model.whites) {
    if (cells[i] === CS.Bulb) lightUp(i)
  }

  const steps: LogicStep[] = []
  const w = puzzle.width

  const setCell = (i: number, v: CellState, rule: number, extra = '') => {
    if (cells[i] !== CS.Unknown) return false
    cells[i] = v
    if (v === CS.Bulb) lightUp(i)
    steps.push({
      index: i,
      value: v,
      rule,
      label: `${RULE_LABELS[rule]}${extra} · ${posLabel(w, i)}`,
    })
    return true
  }

  // —— R3 的暗格组 ——
  // 初始：每个暗格一组，成员 = 行段 ∪ 列段里可见的暗格（含自己，Set 天然去重）
  const groups = new Map<number, Set<number>>()
  for (const i of model.whites) {
    if (lit[i]) continue // 亮格不需要被照亮，不建组
    const g = new Set<number>()
    for (const j of model.rowSegCells[model.rowSeg[i]!]!) if (!lit[j]) g.add(j)
    for (const j of model.colSegCells[model.colSeg[i]!]!) if (!lit[j]) g.add(j)
    groups.set(i, g)
  }

  for (;;) {
    let changed = false

    // R1 / R2：数字墙
    for (const cw of clueWallPositions(puzzle)) {
      let near = 0
      const cands: number[] = []
      for (const j of cw.adj) {
        if (cells[j] === CS.Bulb) near++
        else if (cells[j] === CS.Unknown && !lit[j]) cands.push(j)
      }
      if (near > cw.clue) continue // 玩家摆错了，逻辑层不管
      if (near === cw.clue) {
        // 数字已满足（含数字 0）：候选邻格打叉；
        // 已打叉或已照亮的邻格同等视为排除，跳过不打叉（省操作）
        for (const j of cands) {
          if (setCell(j, CS.Mark, 1, `（数字 ${cw.clue} 已满足）`)) changed = true
        }
      } else if (cands.length === cw.clue - near) {
        // 还差 N 个、候选恰好 N 个 → 全是灯泡
        for (const j of cands) {
          if (setCell(j, CS.Bulb, 2, `（数字 ${cw.clue} 还差 ${cw.clue - near}）`)) changed = true
        }
      }
    }

    // R3：暗格组规则
    // ① 本格已经变亮 → 整组移除（不再需要被照亮）
    for (const i of [...groups.keys()]) {
      if (lit[i]) groups.delete(i)
    }
    // ② 根据盘面移除剩余组里的可见亮格和打叉格（都不能放灯泡）
    for (const g of groups.values()) {
      for (const j of [...g]) {
        if (lit[j] || cells[j] === CS.Mark) g.delete(j)
      }
    }
    // ③ 组里只剩一个格子 → 必定是灯泡
    for (const [i, g] of [...groups]) {
      if (g.size !== 1) continue
      const only = g.values().next().value as number | undefined
      if (only === undefined) continue
      if (setCell(only, CS.Bulb, 3, `（照亮 ${posLabel(w, i)}）`)) changed = true
    }

    // R4：假放灯泡规则——某格放灯泡会烧掉数字墙的候选格、导致凑不够 → 只能打叉
    // 先汇总每面「未满足且仍可满足」的数字墙的候选集
    const wallInfo: Array<{ clue: number; near: number; cands: number[] }> = []
    for (const cw of clueWallPositions(puzzle)) {
      let near = 0
      const cands: number[] = []
      for (const j of cw.adj) {
        if (cells[j] === CS.Bulb) near++
        else if (cells[j] === CS.Unknown && !lit[j]) cands.push(j)
      }
      if (near > cw.clue) continue // 玩家摆错了，逻辑层不管
      if (near + cands.length < cw.clue) continue // 墙本身已凑不够（与 X 无关）
      if (!cands.length) continue
      wallInfo.push({ clue: cw.clue, near, cands })
    }
    // 对每个候选格假放一次灯泡，看会不会烧掉哪面墙的候选
    for (const X of model.whites) {
      if (cells[X] !== CS.Unknown || lit[X]) continue
      for (const wi of wallInfo) {
        // X 的灯泡照亮它的行段/列段：数一下烧掉这面墙多少候选
        let hit = 0
        for (const j of wi.cands) {
          if (model.rowSeg[j] === model.rowSeg[X] || model.colSeg[j] === model.colSeg[X]) hit++
        }
        if (hit === 0) continue
        const adj = wi.cands.includes(X) ? 1 : 0
        // 放上 X 后：已有灯泡 + X 自己（相邻才算）+ 剩余候选，仍凑不够墙数字
        if (wi.near + adj + wi.cands.length - hit < wi.clue) {
          if (
            setCell(
              X,
              CS.Mark,
              4,
              `（数字 ${wi.clue} 可放位 ${wi.cands.length} → ${wi.cands.length - hit}）`,
            )
          ) {
            changed = true
          }
          break
        }
      }
    }

    if (!changed) break
  }

  const finalState: GameState = {
    puzzleId: puzzle.id,
    width: puzzle.width,
    height: puzzle.height,
    cells,
  }
  // 推完 = 每格空地都已推定，或已被照亮（亮格天然排除，无需再打叉）
  const complete = model.whites.every((i) => cells[i] !== CS.Unknown || lit[i] === 1)
  return { puzzleId: puzzle.id, steps, finalState, complete }
}

/** 单条规则能否从当前状态推出新结论（供审计脚本用） */
export function nextLogicStep(puzzle: Puzzle, state: GameState): LogicStep | null {
  const plan = planLogicSolve(puzzle, state)
  return plan.steps[0] ?? null
}

export { cellIndex }
