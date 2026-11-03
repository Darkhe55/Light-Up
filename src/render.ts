import type { GameState, Puzzle, ValidationResult } from './types'
import { CellState as CS } from './types'
import { buildModel, cellIndex, cellValue } from './state'
import { litGrid } from './validate'

/** 10×10 基准格距；所有描边/字号按此比例缩放 */
export const BASE_CELL = 48

export interface BoardMetrics {
  cell: number
  pad: number
  width: number
  height: number
  svgWidth: number
  svgHeight: number
  k: number
}

export function metricsFor(puzzle: Puzzle): BoardMetrics {
  const cell = BASE_CELL
  const pad = cell * 0.5
  return {
    cell,
    pad,
    width: puzzle.width,
    height: puzzle.height,
    svgWidth: pad * 2 + puzzle.width * cell,
    svgHeight: pad * 2 + puzzle.height * cell,
    k: cell / BASE_CELL,
  }
}

/** 格子左上角像素坐标 */
export function cellXY(m: BoardMetrics, cx: number, cy: number) {
  return { x: m.pad + cx * m.cell, y: m.pad + cy * m.cell }
}

/** 格子中心像素坐标 */
export function cellCenter(m: BoardMetrics, cx: number, cy: number) {
  return { x: m.pad + (cx + 0.5) * m.cell, y: m.pad + (cy + 0.5) * m.cell }
}

export function clientToViewBox(svg: SVGSVGElement, clientX: number, clientY: number) {
  const ctm = svg.getScreenCTM()
  if (!ctm) return null
  const pt = svg.createSVGPoint()
  pt.x = clientX
  pt.y = clientY
  const p = pt.matrixTransform(ctm.inverse())
  return { x: p.x, y: p.y }
}

/** viewBox 坐标 → 格子索引；越界返回 null */
export function hitTestCell(m: BoardMetrics, puzzle: Puzzle, x: number, y: number): number | null {
  const cx = Math.floor((x - m.pad) / m.cell)
  const cy = Math.floor((y - m.pad) / m.cell)
  if (cx < 0 || cy < 0 || cx >= puzzle.width || cy >= puzzle.height) return null
  return cellIndex(puzzle.width, cx, cy)
}

/** 灯泡图标（光晕 + 灯芯 + 光芒） */
function bulbMarkup(m: BoardMetrics, x: number, y: number, index: number, conflict: boolean): string {
  const c = m.cell
  const cx = x + c * 0.5
  const cy = y + c * 0.5
  const rays: string[] = []
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2
    const r1 = c * 0.3
    const r2 = c * 0.42
    rays.push(
      `M ${(cx + Math.cos(a) * r1).toFixed(2)} ${(cy + Math.sin(a) * r1).toFixed(2)} L ${(cx + Math.cos(a) * r2).toFixed(2)} ${(cy + Math.sin(a) * r2).toFixed(2)}`,
    )
  }
  return `<g class="bulb${conflict ? ' conflict' : ''}" data-cell="${index}">
    <circle class="bulb-glow" cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${(c * 0.44).toFixed(2)}" />
    <circle class="bulb-core" cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${(c * 0.2).toFixed(2)}" />
    <path class="bulb-rays" d="${rays.join(' ')}" />
  </g>`
}

/** × 标记（玩家自标此处无灯泡） */
function markMarkup(m: BoardMetrics, x: number, y: number, index: number): string {
  const c = m.cell
  const cx = x + c * 0.5
  const cy = y + c * 0.5
  const s = c * 0.16
  const sw = Math.max(1.6, 2.6 * m.k)
  return `<g class="mark" data-cell="${index}">
    <line x1="${(cx - s).toFixed(2)}" y1="${(cy - s).toFixed(2)}" x2="${(cx + s).toFixed(2)}" y2="${(cy + s).toFixed(2)}" stroke-width="${sw}" />
    <line x1="${(cx - s).toFixed(2)}" y1="${(cy + s).toFixed(2)}" x2="${(cx + s).toFixed(2)}" y2="${(cy - s).toFixed(2)}" stroke-width="${sw}" />
  </g>`
}

export function renderBoard(
  puzzle: Puzzle,
  state: GameState,
  result: ValidationResult,
): string {
  const m = metricsFor(puzzle)
  const model = buildModel(puzzle)
  const w = puzzle.width
  const h = puzzle.height
  const lit = litGrid(puzzle, state)

  const overSet = new Set(result.overWalls)
  const underSet = new Set(result.underWalls)
  const conflictSet = new Set(result.conflictBulbs)

  const numSize = 21 * m.k
  const inset = 1.5 * m.k

  const parts: string[] = []
  parts.push(
    `<svg class="board-svg" viewBox="0 0 ${m.svgWidth} ${m.svgHeight}" width="${m.svgWidth}" height="${m.svgHeight}" xmlns="http://www.w3.org/2000/svg">`,
  )

  // 渐变：照亮底 / 灯泡光晕
  parts.push(`<defs>
    <radialGradient id="bulb-glow-grad" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#ffe9a8" stop-opacity="0.95" />
      <stop offset="55%" stop-color="#ffd76a" stop-opacity="0.45" />
      <stop offset="100%" stop-color="#ffd76a" stop-opacity="0" />
    </radialGradient>
    <linearGradient id="lit-grad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#fbe7b4" />
      <stop offset="100%" stop-color="#f7d99a" />
    </linearGradient>
  </defs>`)

  // 格子底（照亮 / 未照亮 / 墙）
  for (let cy = 0; cy < h; cy++) {
    for (let cx = 0; cx < w; cx++) {
      const index = cellIndex(w, cx, cy)
      const { x, y } = cellXY(m, cx, cy)
      const wall = model.wall[index]
      const over = overSet.has(index)
      const cls = wall ? 'cell wall' : lit[index] ? 'cell lit' : 'cell dark'
      parts.push(
        `<rect class="${cls}" data-cell="${index}" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${m.cell}" height="${m.cell}" rx="${over ? 10 * m.k : 5 * m.k}" />`,
      )
    }
  }

  // 悬停层 / 演示高亮层
  parts.push('<g class="hover-layer"></g>')
  parts.push('<g class="flash-layer"></g>')

  // × 标记
  for (const i of model.whites) {
    if (cellValue(state, i) !== CS.Mark) continue
    const cx = i % w
    const cy = Math.floor(i / w)
    const { x, y } = cellXY(m, cx, cy)
    parts.push(markMarkup(m, x, y, i))
  }

  // 墙 + 数字
  for (let cy = 0; cy < h; cy++) {
    for (let cx = 0; cx < w; cx++) {
      const index = cellIndex(w, cx, cy)
      if (!model.wall[index]) continue
      const { x, y } = cellXY(m, cx, cy)
      const clue = model.clue[index]
      const over = overSet.has(index)
      const under = underSet.has(index)
      const cls = over ? 'wall-num over' : under ? 'wall-num under' : 'wall-num'
      if (clue === null) {
        parts.push(
          `<rect class="wall-face" x="${(x + inset).toFixed(2)}" y="${(y + inset).toFixed(2)}" width="${(m.cell - inset * 2).toFixed(2)}" height="${(m.cell - inset * 2).toFixed(2)}" rx="${6 * m.k}" />`,
        )
      } else {
        parts.push(
          `<rect class="wall-face" x="${(x + inset).toFixed(2)}" y="${(y + inset).toFixed(2)}" width="${(m.cell - inset * 2).toFixed(2)}" height="${(m.cell - inset * 2).toFixed(2)}" rx="${6 * m.k}" />` +
            `<text class="${cls}" x="${(x + m.cell / 2).toFixed(2)}" y="${(y + m.cell / 2).toFixed(2)}" style="font-size:${numSize}px">${clue}</text>`,
        )
      }
    }
  }

  // 灯泡
  for (const i of model.whites) {
    if (cellValue(state, i) !== CS.Bulb) continue
    const cx = i % w
    const cy = Math.floor(i / w)
    const { x, y } = cellXY(m, cx, cy)
    parts.push(bulbMarkup(m, x, y, i, conflictSet.has(i)))
  }

  parts.push('</svg>')
  return parts.join('\n')
}

/* ———————————————————— 悬停 / 演示高亮 ———————————————————— */

export function hoverMarkup(m: BoardMetrics, cell: number | null): string {
  if (cell === null) return ''
  const cx = cell % m.width
  const cy = Math.floor(cell / m.width)
  const { x, y } = cellXY(m, cx, cy)
  const inset = 1.5 * m.k
  return `<rect class="cell-hover" x="${(x + inset).toFixed(2)}" y="${(y + inset).toFixed(2)}" width="${(m.cell - inset * 2).toFixed(2)}" height="${(m.cell - inset * 2).toFixed(2)}" rx="${6 * m.k}" />`
}

export function updateHover(svg: SVGSVGElement, m: BoardMetrics, cell: number | null): void {
  const layer = svg.querySelector('.hover-layer')
  if (!layer) return
  layer.innerHTML = hoverMarkup(m, cell)
}

export function flashMarkup(m: BoardMetrics, cell: number | null): string {
  if (cell === null) return ''
  const cx = cell % m.width
  const cy = Math.floor(cell / m.width)
  const { x, y } = cellXY(m, cx, cy)
  const inset = 1 * m.k
  return `<rect class="cell-flash" x="${(x + inset).toFixed(2)}" y="${(y + inset).toFixed(2)}" width="${(m.cell - inset * 2).toFixed(2)}" height="${(m.cell - inset * 2).toFixed(2)}" rx="${6 * m.k}" />`
}

export function updateFlash(svg: SVGSVGElement, m: BoardMetrics, cell: number | null): void {
  const layer = svg.querySelector('.flash-layer')
  if (!layer) return
  layer.innerHTML = flashMarkup(m, cell)
}
