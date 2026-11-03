/**
 * 点灯（Light Up / Akari）核心类型
 *
 * 规则：
 * 1. 题板由「空地」和「墙」组成；部分墙上有数字 0–4
 * 2. 在空地放灯泡，灯泡沿横向/纵向照亮，直到被墙挡住
 * 3. 数字墙四邻（上下左右）的灯泡数必须等于数字
 * 4. 所有空地都必须被照亮
 * 5. 任意两个灯泡不能互相照亮（同一行/列段内只能有一个灯泡）
 */

/** 无数字墙（题面串里记作 '#'） */
export const WALL = -1

/** 题面格子：null = 空地；WALL(-1) = 无数字墙；0–4 = 数字墙 */
export type ClueCell = typeof WALL | 0 | 1 | 2 | 3 | 4 | null

/** 空地状态：未定 / 灯泡 / 自标无灯泡（×） */
export const enum CellState {
  Unknown = 0,
  Bulb = 1,
  Mark = 2,
}

export interface Puzzle {
  id: string
  name: string
  width: number
  height: number
  /** row-major，length = W*H */
  cells: ClueCell[]
  /** 参考解（'o' = 灯泡，'.' = 其它），length = W*H */
  solution?: string
  difficulty: 'easy' | 'medium' | 'hard' | 'custom'
}

export interface GameState {
  puzzleId: string
  width: number
  height: number
  /** row-major，length = W*H；墙格子恒为 Unknown（不可交互） */
  cells: CellState[]
}

export interface Move {
  index: number
  from: CellState
  to: CellState
}

export interface ValidationResult {
  /** 相邻灯泡数 > 数字 的墙（硬冲突） */
  overWalls: number[]
  /** 相邻灯泡数 < 数字 的墙（还没满足） */
  underWalls: number[]
  /** 与别的灯泡互相照亮的灯泡格 */
  conflictBulbs: number[]
  /** 未被照亮的空地 */
  darkCells: number[]
  bulbCount: number
  litCount: number
  solved: boolean
}

/** 逻辑解谜器的一条推理结论 */
export interface LogicStep {
  index: number
  value: CellState
  /** 第几条规则 */
  rule: number
  /** 人类可读的推理依据 */
  label: string
}

/** 逻辑解题计划：推理期一次性算完，回放期只读它 */
export interface LogicPlan {
  puzzleId: string
  steps: LogicStep[]
  /** 推理终态（与逐条施加后一致） */
  finalState: GameState
  /** 是否所有空地都已推定或被照亮（亮格天然排除；false = 规则推不动，还剩假设推演） */
  complete: boolean
}
