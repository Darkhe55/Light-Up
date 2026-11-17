import './styles.css'
import type { CellState, ClueCell, GameState, Move, Puzzle } from './types'
import { CellState as CS, WALL } from './types'
import {
  actionValue,
  applyMove,
  cellValue,
  cloneState,
  createEmptyState,
  deserializeState,
  invertMove,
  isWall,
  leftAction,
  rightAction,
  serializeState,
  type PaintAction,
} from './state'
import {
  getPuzzle,
  getReferenceSolution,
  puzzles as builtinPuzzles,
  stateFromReference,
} from './puzzles'
import { loadSavedPuzzles, removeSavedPuzzle, savePuzzleToLibrary } from './library'
import {
  clientToViewBox,
  hitTestCell,
  metricsFor,
  renderBoard,
  updateFlash,
  updateHover,
} from './render'
import { validate } from './validate'
import { planLogicSolve } from './logic'
import { countSolutions, consistentCell, solvePuzzle } from './solver'
import { isMuted, playForCell, playSolved, resumeAudio, setMuted } from './audio'
import {
  clearProgress,
  initStore,
  readLastPuzzle,
  readProgress,
  storeInProject,
  storeLocationLabel,
  writeLastPuzzle,
  writeProgress,
  type ProgressEntry,
} from './store'

interface Session {
  puzzle: Puzzle
  state: GameState
  /** 一次手势/一次操作算一个撤销单元 */
  undo: Move[][]
  redo: Move[][]
}

function $(sel: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(sel)
  if (!el) throw new Error(`missing ${sel}`)
  return el
}

function loadSave(puzzleId: string): GameState | null {
  try {
    const data = readProgress(puzzleId) as ProgressEntry | null
    if (!data || data.version !== 1) return null
    if (data.width === undefined || data.height === undefined) return null
    return deserializeState({
      version: data.version,
      puzzleId: data.puzzleId,
      width: data.width,
      height: data.height,
      cells: data.cells,
    })
  } catch {
    return null
  }
}

function saveState(session: Session): void {
  writeProgress(serializeState(session.state))
}

function difficultyLabel(d: Puzzle['difficulty']): string {
  return d === 'easy' ? '入门' : d === 'medium' ? '进阶' : d === 'custom' ? '自定义' : '挑战'
}

const app = document.querySelector('#app')
if (!app) throw new Error('no #app')

app.innerHTML = `
  <header class="topbar">
    <div class="brand">
      <h1>点灯</h1>
      <p>Light Up · 放灯泡照亮所有空地 · 数字墙四邻灯泡数 = 数字 · 灯泡不能互照</p>
    </div>
    <div class="brand">
      <p style="margin:0">左键循环：空 → 灯泡 → × → 空 ｜ 右键直接标 ×</p>
    </div>
  </header>

  <div class="layout">
    <aside class="panel">
      <h2>题面</h2>
      <div class="toolbar" style="margin-top:0">
        <button class="btn" id="btn-random" type="button">随机抽题</button>
        <button class="btn" id="btn-custom" type="button">自定义</button>
        <button class="btn" id="btn-mute" type="button">音效：开</button>
      </div>
      <div class="puzzle-list" id="puzzle-list"></div>

      <div class="custom-editor" id="custom-editor" hidden>
        <h2>自定义题板</h2>
        <div class="custom-row">
          <label>宽 <input id="custom-w" type="number" min="3" max="50" value="6" /></label>
          <label>高 <input id="custom-h" type="number" min="3" max="60" value="6" /></label>
          <button class="btn" id="custom-regen" type="button">生成网格</button>
        </div>
        <div class="custom-hint">点击循环：空 → 墙 → 0 → 1 → 2 → 3 → 4 → 空 ｜ 键盘：方向键移动，0–4 填数字，# 无数字墙，. / 退格清空，Enter / Tab 下一格</div>
        <div class="custom-grid" id="custom-grid"></div>
        <div class="toolbar" style="margin-top:10px">
          <button class="btn primary" id="custom-apply" type="button">载入题板</button>
          <button class="btn" id="custom-save" type="button">保存到题库</button>
          <button class="btn" id="custom-unique" type="button">唯一解校验</button>
          <button class="btn" id="custom-solve" type="button">求解</button>
          <button class="btn" id="custom-logic" type="button">逻辑解题</button>
          <button class="btn danger" id="custom-close" type="button">关闭</button>
        </div>
        <div class="custom-msg" id="custom-msg"></div>
      </div>

      <div class="toolbar">
        <button class="btn primary" id="btn-check" type="button">检查</button>
        <button class="btn" id="btn-undo" type="button">撤销</button>
        <button class="btn" id="btn-redo" type="button">重做</button>
        <button class="btn" id="btn-hint" type="button">提示一格</button>
        <button class="btn" id="btn-logic" type="button">逻辑解题</button>
        <button class="btn" id="btn-solve" type="button">显示解</button>
        <button class="btn danger" id="btn-clear" type="button">清空</button>
      </div>

      <div class="status" id="status">选择左侧题目开始。左键放灯泡，再点标 ×。</div>

      <div class="legend">
        <div><kbd>左键</kbd> 循环 空→灯泡→×→空 · <kbd>右键</kbd> 标 × / 取消 · <kbd>拖拽</kbd> 连续涂</div>
        <div><kbd>中键拖拽</kbd> 平移画布 · <kbd>滚轮</kbd> 缩放 · <kbd>+</kbd>/<kbd>−</kbd>/<kbd>0</kbd> 放大/缩小/复位</div>
        <div><kbd>Z</kbd> / <kbd>Shift+Z</kbd> 撤销 / 重做</div>
        <div><kbd>C</kbd> 检查 · <kbd>H</kbd> 提示 · <kbd>L</kbd> 逻辑解题/停止回放 · <kbd>P</kbd> 暂停/继续</div>
        <div><kbd>R</kbd> 随机 · <kbd>M</kbd> 音效开关 · <kbd>Esc</kbd> 清空</div>
      </div>
    </aside>

    <main class="panel board-wrap" id="board-wrap">
      <div class="zoom-bar">
        <button class="btn" id="zoom-out" type="button" title="缩小">−</button>
        <span class="zoom-label" id="zoom-label">100%</span>
        <button class="btn" id="zoom-in" type="button" title="放大">+</button>
        <button class="btn" id="zoom-reset" type="button">复位</button>
      </div>
      <div id="board"></div>
    </main>
  </div>

  <p class="footer-note">所有空地都要被照亮 · 两个灯泡不能互相看见 · 数字墙四邻灯泡数必须等于数字</p>
`

let session: Session | null = null
let pendingDeleteId: string | null = null

/** 内置 + 本地保存的自定义题库 */
let library: Puzzle[] = [...builtinPuzzles]

function refreshLibrary() {
  const saved = loadSavedPuzzles()
  library = [...saved, ...builtinPuzzles]
}

function findPuzzle(id: string): Puzzle | undefined {
  return library.find((p) => p.id === id) || getPuzzle(id)
}

/** 稳定排序：自定义已存 → 其它内置（保持原顺序） */
function sortedLibrary(): Puzzle[] {
  const rank = (p: Puzzle) => (p.difficulty === 'custom' ? 0 : 1)
  return [...library].sort((a, b) => rank(a) - rank(b))
}

function currentResult() {
  if (!session) return null
  return validate(session.state, session.puzzle)
}

function setStatus(text: string, tone: 'ok' | 'bad' | 'solving' | '' = '') {
  const el = $('#status')
  el.textContent = text
  el.className = 'status' + (tone ? ` ${tone}` : '')
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      default:
        return '&#39;'
    }
  })
}

function renderPuzzleList(): void {
  refreshLibrary()
  const list = $('#puzzle-list')
  list.innerHTML = sortedLibrary()
    .map((p) => {
      const active = session?.puzzle.id === p.id ? ' active' : ''
      const isCustom = p.difficulty === 'custom'
      const confirming = pendingDeleteId === p.id
      const actions = isCustom
        ? `<button class="puzzle-act" type="button" data-edit="${escapeHtml(p.id)}" title="编辑题面">编辑</button>` +
          `<button class="puzzle-act danger${confirming ? ' confirm' : ''}" type="button" data-del="${escapeHtml(p.id)}" title="${confirming ? '再点一次确认删除' : '从题库删除'}">${confirming ? '确认' : '×'}</button>`
        : ''
      return `
        <div class="puzzle-row">
          <button class="puzzle-item${active}" data-id="${escapeHtml(p.id)}" type="button">
            <span class="title">${escapeHtml(p.name)}</span>
            <span class="meta">${p.width}×${p.height} · ${difficultyLabel(p.difficulty)}</span>
          </button>
          ${actions}
        </div>
      `
    })
    .join('')
  list.querySelectorAll<HTMLButtonElement>('.puzzle-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const p = btn.dataset.id ? findPuzzle(btn.dataset.id) : undefined
      if (p) selectPuzzle(p)
    })
  })
  list.querySelectorAll<HTMLButtonElement>('[data-edit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.edit
      if (id) editPuzzle(id)
    })
  })
  list.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.del
      if (!id) return
      if (pendingDeleteId === id) deletePuzzle(id)
      else {
        pendingDeleteId = id
        renderPuzzleList()
      }
    })
  })
}


// 删除二次确认：点击其它位置自动取消，避免误触
document.addEventListener('click', (e) => {
  if (!pendingDeleteId) return
  const target = e.target as Element | null
  if (target?.closest('[data-del]')) return
  pendingDeleteId = null
  renderPuzzleList()
})


function renderBoardOnly() {
  if (!session) return
  const result = validate(session.state, session.puzzle)
  const svg = renderBoard(session.puzzle, session.state, result)
  const board = $('#board')
  board.innerHTML = svg
  bindBoardEvents()
  applyViewBox()
}

function refresh() {
  renderPuzzleList()
  renderBoardOnly()
  if (!session) return
  const result = currentResult()
  if (!result) return
  if (result.solved) {
    setStatus('完成！所有空地都被照亮，数字全部吻合，灯泡互不相见。', 'ok')
    playSolved()
    return
  }
  const w = session.puzzle.width
  const h = session.puzzle.height
  const whites = w * h - countWalls()
  const bits: string[] = []
  bits.push(`灯泡 ${result.bulbCount}`)
  bits.push(`照亮 ${result.litCount}/${whites}`)
  if (result.underWalls.length) bits.push(`${result.underWalls.length} 面数字墙未满足`)
  if (result.overWalls.length) bits.push(`${result.overWalls.length} 面数字墙超了`, )
  if (result.conflictBulbs.length) bits.push(`${result.conflictBulbs.length} 个灯泡互照`)
  if (result.darkCells.length) bits.push(`${result.darkCells.length} 格未照亮`)
  setStatus(bits.join(' · '))
}

function countWalls(): number {
  if (!session) return 0
  let n = 0
  for (let i = 0; i < session.puzzle.cells.length; i++) {
    if (isWall(session.puzzle, i)) n++
  }
  return n
}

function selectPuzzle(puzzle: Puzzle) {
  stopLogic()
  const saved = loadSave(puzzle.id)
  session = {
    puzzle,
    state: saved ?? createEmptyState(puzzle),
    undo: [],
    redo: [],
  }
  writeLastPuzzle(puzzle.id)
  refresh()
  setStatus(`已载入「${puzzle.name}」。左键放灯泡，再点一次标 ×。`)
}

/** 一次手势的所有落子（撤销单元） */
function pushMoves(moves: Move[]) {
  if (!session || !moves.length) return
  for (const mv of moves) applyMove(session.state, mv)
  session.undo.push(moves)
  session.redo.length = 0
  saveState(session)
}

function pushMove(move: Move) {
  pushMoves([move])
}

function bindBoardEvents() {
  const board = $('#board')
  const svg = board.querySelector('svg.board-svg') as SVGSVGElement | null
  if (!svg) return

  applyViewBox()

  svg.addEventListener('contextmenu', (e) => e.preventDefault())

  let painting = false
  let paintAction: PaintAction | null = null
  let panning = false
  let panMoved = false
  let lastClient = { x: 0, y: 0 }
  let stroke: Move[] = []

  const hitAt = (e: PointerEvent) => {
    if (!session) return null
    const vb = clientToViewBox(svg, e.clientX, e.clientY)
    if (!vb) return null
    const m = metricsFor(session.puzzle)
    return hitTestCell(m, session.puzzle, vb.x, vb.y)
  }

  const hoverAt = (e: PointerEvent) => {
    if (!session) return
    const m = metricsFor(session.puzzle)
    const hit = hitAt(e)
    updateHover(svg, m, hit)
  }
  svg.addEventListener('pointermove', hoverAt)
  svg.addEventListener('pointerleave', () => {
    updateHover(svg, metricsFor(session!.puzzle), null)
  })

  svg.addEventListener('wheel', (e) => {
    e.preventDefault()
        e.stopPropagation()
    const vb = clientToViewBox(svg, e.clientX, e.clientY)
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
    setZoom(zoom * factor, vb ?? undefined)
  }, { passive: false })

  svg.addEventListener('pointerdown', (e) => {
    resumeAudio()
    lastClient = { x: e.clientX, y: e.clientY }

    // 中键 / 空格平移
    if (e.button === 1) {
      e.preventDefault()
      panning = true
      panMoved = false
      $('#board').classList.add('panning')
      try {
        svg.setPointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      return
    }

    if (e.button !== 0 && e.button !== 2) return
    const hit = hitAt(e)
    // hit 是格子索引，0 是合法值：必须显式判 null
    if (hit === null) return
    e.preventDefault()
    try {
      svg.setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }

    painting = true
    stroke = []
    if (e.button === 2) {
      paintAction = rightAction(cellValue(session!.state, hit))
    } else {
      paintAction = leftAction(cellValue(session!.state, hit))
    }
    applyPaint(hit)
  })

  function applyPaint(index: number) {
    if (!session || !painting || !paintAction) return
    if (isWall(session.puzzle, index)) return
    const from = cellValue(session.state, index)
    const to = actionValue(paintAction)
    if (from === to) return
    if (stroke.some((m) => m.index === index)) return
    stroke.push({ index, from, to })
    setCellLocal(index, to)
  }

  svg.addEventListener('pointermove', (e) => {
    if (panning) {
      const dx = e.clientX - lastClient.x
      const dy = e.clientY - lastClient.y
      if (!panMoved && Math.hypot(dx, dy) < 6) return
      panMoved = true
      const rect = svg.getBoundingClientRect()
      const { w, h } = baseVB()
      const scaleX = w / zoom / rect.width
      const scaleY = h / zoom / rect.height
      panX -= dx * scaleX
      panY -= dy * scaleY
      lastClient = { x: e.clientX, y: e.clientY }
      applyViewBox()
      return
    }
    if (!painting) return
    const hit = hitAt(e)
    if (hit !== null) applyPaint(hit)
  })

  const endPointer = (e: PointerEvent) => {
    if (panning) {
      panning = false
      $('#board').classList.remove('panning')
      try {
        svg.releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      return
    }
    if (!painting) return
    painting = false
    paintAction = null
    try {
      svg.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    if (stroke.length) {
      pushMoves(stroke)
      stroke = []
      refresh()
    }
  }
  svg.addEventListener('pointerup', endPointer)
  svg.addEventListener('pointercancel', endPointer)
}

/** 拖拽过程中先本地生效，抬手时统一进撤销栈 */
function setCellLocal(index: number, value: CellState) {
  if (!session) return
  session.state.cells[index] = value
  const result = validate(session.state, session.puzzle)
  const svg = document.querySelector('svg.board-svg') as SVGSVGElement | null
  if (svg) {
    // 只重绘视觉（保留指针捕获）：局部更新太重，直接整板重绘但保留事件
    renderInto(svg, result)
  }
  const isBulb = value === CS.Bulb
  playForCell(isBulb, 1)
}

/** 把新 SVG 内容写进现有 <svg>（不替换元素，避免丢失指针捕获） */
function renderInto(svg: SVGSVGElement, result: ReturnType<typeof validate>) {
  if (!session) return
  const html = renderBoard(session.puzzle, session.state, result)
  const fresh = document.createElement('div')
  fresh.innerHTML = html
  const next = fresh.querySelector('svg')
  if (!next) return
  svg.innerHTML = next.innerHTML
}

function undo() {
  if (!session || !session.undo.length) return
  const group = session.undo.pop()!
  for (const mv of group) applyMove(session.state, invertMove(mv))
  session.redo.push(group)
  saveState(session)
  refresh()
}

function redo() {
  if (!session || !session.redo.length) return
  const group = session.redo.pop()!
  for (const mv of group) applyMove(session.state, mv)
  session.undo.push(group)
  saveState(session)
  refresh()
}

function clearBoard() {
  if (!session) return
  stopLogic()
  session.state = createEmptyState(session.puzzle)
  session.undo = []
  session.redo = []
  saveState(session)
  refresh()
  setStatus('已清空当前盘面。')
}

function check() {
  const result = currentResult()
  if (!session || !result) return
  if (result.solved) {
    setStatus('正确！所有空地都被照亮，数字全部吻合。', 'ok')
  } else {
    const parts: string[] = []
    if (result.overWalls.length) parts.push(`${result.overWalls.length} 面数字墙灯泡超了`)
    if (result.underWalls.length) parts.push(`${result.underWalls.length} 面数字墙未满足`)
    if (result.conflictBulbs.length) parts.push(`${result.conflictBulbs.length} 个灯泡互相照亮`)
    if (result.darkCells.length) parts.push(`${result.darkCells.length} 格还没照亮`)
    setStatus(parts.join(' · ') || '还差一点', 'bad')
  }
  refresh()
}

function hint() {
  if (!session) return
  const hit = consistentCell(session.puzzle, session.state, { maxNodes: 400_000 })
  if (hit) {
    pushMove({ index: hit.index, from: cellValue(session.state, hit.index), to: hit.value })
    refresh()
    setStatus(hit.value === CS.Bulb ? '已揭示一个必然放灯泡的格子。' : '已揭示一个必然不能放灯泡的格子。', 'ok')
    return
  }
  // 解不一致或推不动 → 用参考解/求解器给一格
  let sol = getReferenceSolution(session.puzzle.id)
  if (!sol) {
    const r = solvePuzzle(session.puzzle, { maxNodes: 1_500_000, timeBudgetMs: 8000 })
    if (r.solved && r.solution) sol = r.solution.cells.map((c) => (c === CS.Bulb ? 'o' : '.')).join('')
  }
  if (!sol) {
    setStatus('暂时给不出提示。', 'bad')
    return
  }
  for (let i = 0; i < sol.length; i++) {
    if (isWall(session.puzzle, i)) continue
    const target: CellState = sol[i] === 'o' ? CS.Bulb : CS.Mark
    const cur = cellValue(session.state, i)
    if (cur === target) continue
    pushMove({ index: i, from: cur, to: target })
    refresh()
    setStatus(target === CS.Bulb ? '已揭示一个放灯泡的格子。' : '已揭示一个标 × 的格子。', 'ok')
    return
  }
  setStatus('当前已与可行解一致，或没有可提示的格子。', 'ok')
}

function showSolution() {
  if (!session) return
  const ref = stateFromReference(session.puzzle)
  if (ref) {
    session.state = ref
    session.undo = []
    session.redo = []
    saveState(session)
    refresh()
    setStatus('已填入参考解。', 'ok')
    return
  }
  const area = session.puzzle.width * session.puzzle.height
  let budget = 1_500_000
  if (area > 400) budget = 4_000_000
  if (area > 1200) budget = 6_000_000
  const r = solvePuzzle(session.puzzle, { maxNodes: budget, timeBudgetMs: 15_000 })
  if (!r.solved || !r.solution) {
    setStatus(r.timedOut ? '求解超时。' : '无解或数字矛盾。', 'bad')
    return
  }
  const st = createEmptyState(session.puzzle)
  for (let i = 0; i < r.solution.cells.length; i++) {
    if (isWall(session.puzzle, i)) continue
    st.cells[i] = r.solution.cells[i] === CS.Bulb ? CS.Bulb : CS.Mark
  }
  session.state = st
  session.undo = []
  session.redo = []
  saveState(session)
  refresh()
  setStatus('已填入一组可行解。', 'ok')
}

// —— 画布缩放 / 平移 ——
let zoom = 1
let panX = 0
let panY = 0

function baseVB() {
  if (!session) return { w: 400, h: 400 }
  const m = metricsFor(session.puzzle)
  return { w: m.svgWidth, h: m.svgHeight }
}

function applyViewBox() {
  const svg = document.querySelector('svg.board-svg')
  if (!svg) return
  const { w, h } = baseVB()
  const vw = w / zoom
  const vh = h / zoom
  panX = Math.max(0, Math.min(panX, w - vw))
  panY = Math.max(0, Math.min(panY, h - vh))
  svg.setAttribute('viewBox', `${panX} ${panY} ${vw} ${vh}`)
  const label = document.getElementById('zoom-label')
  if (label) label.textContent = `${Math.round(zoom * 100)}%`
}

function setZoom(next: number, anchor?: { x: number; y: number }) {
  const { w, h } = baseVB()
  const oldZoom = zoom
  const z = Math.max(1, Math.min(5, next))
  if (anchor) {
    const u = (anchor.x - panX) / (w / oldZoom)
    const v = (anchor.y - panY) / (h / oldZoom)
    zoom = z
    panX = anchor.x - u * (w / zoom)
    panY = anchor.y - v * (h / zoom)
  } else {
    zoom = z
    const cx = panX + w / oldZoom / 2
    const cy = panY + h / oldZoom / 2
    panX = cx - w / zoom / 2
    panY = cy - h / zoom / 2
  }
  applyViewBox()
}

// —— 逻辑解题动画 ——
let logicPlaying = false
let logicPaused = false
let logicToken = 0
let logicFrame = 0
let logicTotal = 0

function sleep(ms: number, token: number): Promise<boolean> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(token === logicToken), ms)
  })
}

/** 可暂停的等待：暂停期间不计时，继续后接着等完剩余时间 */
function sleepPausable(ms: number, token: number): Promise<boolean> {
  return new Promise((resolve) => {
    let left = ms
    const step = () => {
      if (token !== logicToken) return resolve(false)
      if (logicPaused) {
        setTimeout(step, 60)
        return
      }
      left -= 60
      if (left <= 0) return resolve(true)
      setTimeout(step, 60)
    }
    setTimeout(step, 60)
  })
}

function updateLogicButton() {
  const btn = document.getElementById('btn-logic') as HTMLButtonElement | null
  if (!btn) return
  if (logicPlaying) {
    btn.textContent = '停止回放'
    btn.classList.remove('primary')
    btn.classList.add('danger')
  } else {
    btn.textContent = '逻辑解题'
    btn.classList.add('primary')
    btn.classList.remove('danger')
  }
}

function toggleLogicPause() {
  if (!logicPlaying) return
  logicPaused = !logicPaused
  if (logicPaused) {
    setStatus(`回放已暂停 [${logicFrame}/${logicTotal}] · 按 P 继续`, 'solving')
  } else {
    setStatus(`回放继续 [${logicFrame}/${logicTotal}]…`, 'solving')
  }
}

function flashCell(index: number, isBulb: boolean, streak = 1) {
  const svg = document.querySelector('svg.board-svg') as SVGSVGElement | null
  if (!svg || !session) return
  const m = metricsFor(session.puzzle)
  playForCell(isBulb, streak)
  updateFlash(svg, m, index)
}

function setButtonsDisabled(disabled: boolean) {
  for (const id of ['btn-check', 'btn-undo', 'btn-redo', 'btn-hint', 'btn-solve', 'btn-clear'] as const) {
    const el = document.getElementById(id) as HTMLButtonElement | null
    if (el) el.disabled = disabled
  }
  const board = document.getElementById('board')
  if (board) board.style.pointerEvents = disabled ? 'none' : ''
}

async function playLogicPlan(steps: ReturnType<typeof planLogicSolve>['steps'], token: number) {
  logicTotal = steps.length
  for (let i = 0; i < steps.length; i++) {
    if (token !== logicToken) return
    if (!session) return
    const step = steps[i]!
    pushMove({ index: step.index, from: cellValue(session.state, step.index), to: step.value })
    logicFrame = i + 1
    renderBoardOnly()
    flashCell(step.index, step.value === CS.Bulb, 1)
    setStatus(`回放 [${logicFrame}/${logicTotal}] 规则${step.rule} · ${step.label}`, 'solving')
    if (i < steps.length - 1) {
      const more = await sleepPausable(160, token)
      if (!more) return
    }
  }
  await sleepPausable(200, token)
}

async function runLogicSolver() {
  if (!session || logicPlaying) return
  const puzzle = session.puzzle
  const snapshot = cloneState(session.state)

  logicPlaying = true
  logicPaused = false
  logicFrame = 0
  logicToken++
  const token = logicToken
  setButtonsDisabled(true)
  updateLogicButton()
  setStatus('逻辑解题：推理中…', 'solving')
  await sleep(16, token)
  if (token !== logicToken) return

  const plan = planLogicSolve(puzzle, snapshot)
  if (token !== logicToken) return

  if (!plan.steps.length) {
    logicPlaying = false
    logicPaused = false
    setButtonsDisabled(false)
    updateLogicButton()
    setStatus(plan.complete ? '盘面已全部推定，没有新推演。' : '逻辑规则暂无新推演（已卡关）。')
    return
  }

  setStatus(`推理完成：${plan.steps.length} 步，开始回放…`, 'solving')
  await sleep(240, token)
  if (token !== logicToken) return

  try {
    await playLogicPlan(plan.steps, token)
  } catch {
    /* ignore */
  }

  if (token === logicToken) {
    logicPlaying = false
    logicPaused = false
    setButtonsDisabled(false)
    updateLogicButton()
    if (session && session.puzzle.id === puzzle.id) {
      const result = currentResult()
      if (result?.solved) setStatus('逻辑解题完成，盘面已解出。', 'ok')
      else setStatus(`回放完毕（${plan.steps.length} 步${plan.complete ? '，已全部推定' : '，还剩推不动的格子'}）。`, 'ok')
    }
  }
}

function stopLogic() {
  logicToken++
  logicPlaying = false
  logicPaused = false
  setButtonsDisabled(false)
  updateLogicButton()
}

function pickRandomPuzzle() {
  refreshLibrary()
  const cur = session?.puzzle.id
  const pool = cur ? library.filter((p) => p.id !== cur) : library
  const list = pool.length ? pool : library
  const p = list[Math.floor(Math.random() * list.length)]!
  selectPuzzle(p)
  setStatus(`随机抽到「${p.name}」。`)
}

function toggleMute() {
  const next = !isMuted()
  setMuted(next)
  const btn = document.getElementById('btn-mute')
  if (btn) btn.textContent = next ? '音效：关' : '音效：开'
  if (!next) resumeAudio()
}

// —— 自定义题板 ——
let customCells: ClueCell[] = []
let customW = 6
let customH = 6
/** 键盘光标所在格（0..W*H-1） */
let customCursor = 0
/** 正在编辑的题库条目 id / 名称（null = 新建） */
let editingId: string | null = null
let editingName: string | null = null

function customMsg(text: string, tone: 'ok' | 'bad' | '' = '') {
  const el = document.getElementById('custom-msg')
  if (!el) return
  el.textContent = text
  el.className = 'custom-msg' + (tone ? ` ${tone}` : '')
}

function customEditorOpen(): boolean {
  const panel = document.getElementById('custom-editor')
  return !!panel && !panel.hidden
}

function customCellLabel(v: ClueCell): string {
  if (v === null) return ''
  if (v === WALL) return '█'
  return String(v)
}

function setCustomCell(i: number, value: ClueCell) {
  if (i < 0 || i >= customCells.length) return
  customCells[i] = value
  const btn = document.querySelector<HTMLButtonElement>(`.custom-cell[data-i="${i}"]`)
  if (btn) {
    btn.textContent = customCellLabel(value)
    btn.classList.toggle('empty', value === null)
    btn.classList.toggle('wall', value === WALL)
  }
}

/** 点击循环：空 → 无数字墙 → 0 → 1 → 2 → 3 → 4 → 空 */
function cycleCustomCell(i: number) {
  const cur = customCells[i] ?? null
  const order: ClueCell[] = [null, WALL, 0, 1, 2, 3, 4]
  const idx = order.indexOf(cur)
  setCustomCell(i, order[(idx + 1) % order.length]!)
}

function selectCustomCell(i: number) {
  const max = customW * customH
  if (max <= 0) return
  customCursor = Math.max(0, Math.min(max - 1, i))
  document.querySelectorAll('.custom-cell').forEach((el) => {
    el.classList.toggle('selected', Number((el as HTMLElement).dataset.i) === customCursor)
  })
  const btn = document.querySelector<HTMLButtonElement>(`.custom-cell[data-i="${customCursor}"]`)
  btn?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

function renderCustomGrid() {
  const grid = document.getElementById('custom-grid')
  if (!grid) return
  const w = customW
  const h = customH
  if (customCells.length !== w * h) {
    customCells = new Array<ClueCell>(w * h).fill(null)
  }
  grid.style.gridTemplateColumns = `repeat(${w}, 36px)`
  grid.innerHTML = customCells
    .map((n, i) => {
      const sel = i === customCursor ? ' selected' : ''
      const cls = n === null ? ' empty' : n === WALL ? ' wall' : ''
      return `<button type="button" class="custom-cell${cls}${sel}" data-i="${i}">${customCellLabel(n)}</button>`
    })
    .join('')
  grid.querySelectorAll<HTMLButtonElement>('.custom-cell').forEach((btn) => {
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.i)
      selectCustomCell(i)
      cycleCustomCell(i)
    })
    btn.addEventListener('focus', () => {
      selectCustomCell(Number(btn.dataset.i))
    })
  })
  grid.tabIndex = 0
}

function customMoveCursor(dx: number, dy: number) {
  const w = customW
  const row = Math.floor(customCursor / w)
  const col = customCursor % w
  selectCustomCell((row + dy) * w + (col + dx))
}

function openCustomEditor() {
  const panel = document.getElementById('custom-editor')
  if (!panel) return
  panel.hidden = false
  const wEl = document.getElementById('custom-w') as HTMLInputElement | null
  const hEl = document.getElementById('custom-h') as HTMLInputElement | null
  if (wEl) wEl.value = String(customW)
  if (hEl) hEl.value = String(customH)
  if (customCursor >= customW * customH) customCursor = 0
  renderCustomGrid()
  const editing = editingId ? `正在编辑「${editingName ?? editingId}」。` : ''
  customMsg(`${editing}键盘：方向键移动 · 0–4 填数字 · # 无数字墙 · . / 退格清空 · Enter 下一格`)
  document.getElementById('custom-grid')?.focus()
}

function closeCustomEditor() {
  const panel = document.getElementById('custom-editor')
  if (panel) panel.hidden = true
}

function readCustomSize() {
  const wEl = document.getElementById('custom-w') as HTMLInputElement | null
  const hEl = document.getElementById('custom-h') as HTMLInputElement | null
  const w = Math.max(3, Math.min(50, Number(wEl?.value) || 6))
  const h = Math.max(3, Math.min(60, Number(hEl?.value) || 6))
  if (wEl) wEl.value = String(w)
  if (hEl) hEl.value = String(h)
  return { w, h }
}

function regenCustomGrid() {
  const { w, h } = readCustomSize()
  customW = w
  customH = h
  customCells = new Array<ClueCell>(w * h).fill(null)
  customCursor = 0
  editingId = null
  editingName = null
  renderCustomGrid()
  customMsg(`已生成 ${w}×${h} 网格。方向键移动，0–4 填数字，# 无数字墙。`)
  document.getElementById('custom-grid')?.focus()
}

/** 自定义题面（未保存也能直接玩） */
function makeCustomPuzzle(id: string, name: string): Puzzle {
  return {
    id,
    name,
    width: customW,
    height: customH,
    cells: customCells.slice(),
    difficulty: 'custom',
  }
}

function loadCustomPuzzle() {
  const { w, h } = readCustomSize()
  customW = w
  customH = h
  if (customCells.length !== w * h) {
    customCells = new Array<ClueCell>(w * h).fill(null)
    renderCustomGrid()
    customMsg('网格已重置，请填数字。', 'bad')
    return
  }
  // 载入即入库：用「宽x高」做稳定 id，重复载入同尺寸只覆盖同一条，
  // 否则刷新/切走后再也找不到这块题板（进度是按题 id 存的，id 稳定才能接上）。
  // 编辑已有题目时沿用原 id，保存即覆盖原题。
  const stableId = editingId ?? `custom-${w}x${h}`
  const kept = makeCustomPuzzle(stableId, editingName ?? `自定义 · ${w}×${h}`)
  savePuzzleToLibrary(kept)
  editingId = kept.id
  editingName = kept.name
  stopLogic()
  session = {
    puzzle: kept,
    state: createEmptyState(kept),
    undo: [],
    redo: [],
  }
  zoom = 1
  panX = 0
  panY = 0
  refresh()
  setStatus(`已载入自定义 ${w}×${h}，并存入题库（刷新后仍在列表里）。`)
  customMsg('题板已载入并存入题库，可点「求解」或「逻辑解题」。', 'ok')
}

function saveCustomToLibrary() {
  const { w, h } = readCustomSize()
  if (customCells.length !== w * h) {
    customMsg('请先生成网格并填好数字。', 'bad')
    return
  }
  const isEditing = !!editingId
  const stamp = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const fallback = `自定义 · ${w}×${h} · ${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}${pad(stamp.getHours())}${pad(stamp.getMinutes())}`
  const name = editingName ?? fallback
  const puzzle = makeCustomPuzzle(editingId ?? `custom-${w}x${h}-${Date.now()}`, name)
  savePuzzleToLibrary(puzzle)
  editingId = puzzle.id
  editingName = puzzle.name
  refreshLibrary()
  renderPuzzleList()
  customMsg(`已${isEditing ? '更新' : '保存'}到题库：「${name}」，下次启动仍可选用。`, 'ok')
  setStatus(`自定义盘已存入题库「${name}」。`)
}

function editPuzzle(id: string): void {
  const puzzle = findPuzzle(id)
  if (!puzzle || puzzle.difficulty !== 'custom') return
  editCustomPuzzle(puzzle)
}

function deletePuzzle(id: string): void {
  const puzzle = findPuzzle(id)
  if (!puzzle || puzzle.difficulty !== 'custom') return
  pendingDeleteId = null
  const wasCurrent = session?.puzzle.id === id
  if (editingId === id) {
    editingId = null
    editingName = null
  }
  removeSavedPuzzle(id)
  clearProgress(id)
  refreshLibrary()
  if (wasCurrent) {
    const next = sortedLibrary()[0]
    if (next) {
      selectPuzzle(next)
    } else {
      session = null
      $('#board').innerHTML = ''
      renderPuzzleList()
    }
  } else {
    renderPuzzleList()
  }
  setStatus(`已删除「${puzzle.name}」。`, 'ok')
}

/** 把已保存的自定义题读回编辑器（保存会覆盖原题） */
function editCustomPuzzle(puzzle: Puzzle) {
  const cells = (puzzle as Puzzle & { cells?: ClueCell[] }).cells
  if (!Array.isArray(cells) || cells.length !== puzzle.width * puzzle.height) return
  customW = puzzle.width
  customH = puzzle.height
  customCells = cells.slice()
  customCursor = 0
  editingId = puzzle.id
  editingName = puzzle.name
  const wEl = $('#custom-w') as HTMLInputElement
  const hEl = $('#custom-h') as HTMLInputElement
  if (wEl) wEl.value = String(customW)
  if (hEl) hEl.value = String(customH)
  $('#custom-editor').hidden = false
  renderCustomGrid()
  customMsg(`正在编辑「${puzzle.name}」。保存会覆盖原题。`, 'ok')
  document.getElementById('custom-editor')?.scrollIntoView({ block: 'nearest' })
  document.getElementById('custom-grid')?.focus()
}

/** 用编辑器里的题面做唯一解校验 */
function uniqueCheckCustom() {
  const { w, h } = readCustomSize()
  if (customCells.length !== w * h) {
    customMsg('请先生成网格。', 'bad')
    return
  }
  const puzzle = makeCustomPuzzle(`custom-check-${w}x${h}`, '校验')
  customMsg('校验中…')
  const area = w * h
  const r = countSolutions(puzzle, 2, {
    maxNodes: area > 400 ? 4_000_000 : 1_500_000,
    timeBudgetMs: 20_000,
  })
  if (r.timedOut) {
    customMsg('校验超时：盘面过大。', 'bad')
    return
  }
  if (r.count === 0) {
    customMsg('无解：数字矛盾或有格子永远照不亮。', 'bad')
    return
  }
  if (r.count === 1) {
    customMsg('唯一解 ✓ 这道题可以放心玩。', 'ok')
    return
  }
  customMsg(`不唯一（至少 ${r.count} 个解），玩起来会有分歧。`, 'bad')
}

function solveCustom() {
  if (!session || !session.puzzle.id.startsWith('custom-')) {
    customMsg('请先载入自定义题板。', 'bad')
    return
  }
  const puzzle = session.puzzle
  customMsg('求解中…')
  const area = puzzle.width * puzzle.height
  let budget = 1_500_000
  if (area > 400) budget = 4_000_000
  if (area > 1200) budget = 6_000_000
  const r = solvePuzzle(puzzle, { maxNodes: budget, timeBudgetMs: 15_000 })
  if (!r.solved || !r.solution) {
    customMsg(
      r.timedOut
        ? '求解超时：盘面过大或数字矛盾/无解，可先「逻辑解题」再求解。'
        : '无解或数字矛盾，无法全部照亮。',
      'bad',
    )
    return
  }
  const st = createEmptyState(puzzle)
  for (let i = 0; i < r.solution.cells.length; i++) {
    if (isWall(puzzle, i)) continue
    st.cells[i] = r.solution.cells[i] === CS.Bulb ? CS.Bulb : CS.Mark
  }
  session.state = st
  session.undo = []
  session.redo = []
  saveState(session)
  refresh()
  customMsg(`求解成功（搜索 ${r.nodes} 节点）。`, 'ok')
  setStatus('自定义盘已求解。', 'ok')
}

function logicCustom() {
  if (!session) return
  closeCustomEditor()
  void runLogicSolver()
}

$('#btn-check').addEventListener('click', check)
$('#btn-undo').addEventListener('click', undo)
$('#btn-redo').addEventListener('click', redo)
$('#btn-clear').addEventListener('click', clearBoard)
$('#btn-solve').addEventListener('click', showSolution)
$('#btn-hint').addEventListener('click', hint)
$('#btn-random').addEventListener('click', pickRandomPuzzle)
$('#btn-mute').addEventListener('click', toggleMute)
$('#btn-custom').addEventListener('click', openCustomEditor)
$('#custom-regen').addEventListener('click', regenCustomGrid)
$('#custom-apply').addEventListener('click', loadCustomPuzzle)
$('#custom-save').addEventListener('click', saveCustomToLibrary)
$('#custom-unique').addEventListener('click', uniqueCheckCustom)
$('#custom-solve').addEventListener('click', solveCustom)
$('#custom-logic').addEventListener('click', logicCustom)
$('#custom-close').addEventListener('click', closeCustomEditor)
$('#btn-logic').addEventListener('click', () => {
  resumeAudio()
  if (logicPlaying) stopLogic()
  else void runLogicSolver()
})
$('#zoom-in').addEventListener('click', () => setZoom(zoom * 1.25))
$('#zoom-out').addEventListener('click', () => setZoom(zoom / 1.25))
$('#zoom-reset').addEventListener('click', () => {
  zoom = 1
  panX = 0
  panY = 0
  applyViewBox()
})

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return
  // 待确认删除时，Esc 先取消确认
  if (e.key === 'Escape' && pendingDeleteId) {
    e.preventDefault()
    pendingDeleteId = null
    renderPuzzleList()
    return
  }

  // —— 自定义题板键盘录入（编辑器打开时优先）——
  if (customEditorOpen()) {
    const k = e.key

    if (k >= '0' && k <= '4') {
      e.preventDefault()
      setCustomCell(customCursor, Number(k) as 0 | 1 | 2 | 3 | 4)
      customMoveCursor(1, 0)
      return
    }
    if (k === '#') {
      e.preventDefault()
      setCustomCell(customCursor, WALL)
      customMoveCursor(1, 0)
      return
    }
    if (k === '.' || k === 'Backspace' || k === 'Delete' || k === ' ') {
      e.preventDefault()
      setCustomCell(customCursor, null)
      if (k === 'Backspace') customMoveCursor(-1, 0)
      else customMoveCursor(1, 0)
      return
    }
    if (k === 'ArrowLeft') {
      e.preventDefault()
      customMoveCursor(-1, 0)
      return
    }
    if (k === 'ArrowRight') {
      e.preventDefault()
      customMoveCursor(1, 0)
      return
    }
    if (k === 'ArrowUp') {
      e.preventDefault()
      customMoveCursor(0, -1)
      return
    }
    if (k === 'ArrowDown') {
      e.preventDefault()
      customMoveCursor(0, 1)
      return
    }
    if (k === 'Enter' || k === 'Tab') {
      e.preventDefault()
      if (e.shiftKey) customMoveCursor(-1, 0)
      else customMoveCursor(1, 0)
      return
    }
    if (k === 'Home') {
      e.preventDefault()
      selectCustomCell(Math.floor(customCursor / customW) * customW)
      return
    }
    if (k === 'End') {
      e.preventDefault()
      selectCustomCell(Math.floor(customCursor / customW) * customW + customW - 1)
      return
    }
    if (k === 'Escape') {
      e.preventDefault()
      closeCustomEditor()
      return
    }
  }

  const k = e.key.toLowerCase()
  if (k === 'z' && !e.shiftKey) {
    e.preventDefault()
    undo()
  } else if ((k === 'z' && e.shiftKey) || k === 'y') {
    e.preventDefault()
    redo()
  } else if (k === 'c') {
    e.preventDefault()
    check()
  } else if (k === 'h') {
    e.preventDefault()
    hint()
  } else if (k === 'l') {
    e.preventDefault()
    if (logicPlaying) stopLogic()
    else void runLogicSolver()
  } else if (k === 'p') {
    e.preventDefault()
    toggleLogicPause()
  } else if (k === 'r') {
    e.preventDefault()
    pickRandomPuzzle()
  } else if (k === 'm') {
    e.preventDefault()
    toggleMute()
  } else if (k === '+' || k === '=') {
    e.preventDefault()
    setZoom(zoom * 1.25)
  } else if (k === '-' || k === '_') {
    e.preventDefault()
    setZoom(zoom / 1.25)
  } else if (k === '0') {
    e.preventDefault()
    zoom = 1
    panX = 0
    panY = 0
    applyViewBox()
  } else if (k === 'escape') {
    clearBoard()
  }
})

// 默认载入：先等存储就绪（项目内 data/ 优先，读不到才降级 localStorage），
// 再恢复上次玩的题；找不到就回退到排序第一题
void (async () => {
  try {
    await initStore()
    refreshLibrary()
    let boot: Puzzle | undefined
    const lastId = readLastPuzzle()
    if (lastId) boot = findPuzzle(lastId)
    if (!boot) boot = sortedLibrary()[0]
    if (boot) selectPuzzle(boot)
    else setStatus('没有可用题面。', 'bad')
    if (storeInProject()) {
      const el = $('#status')
      el.textContent += `（题库/进度：${storeLocationLabel()}）`
    }
  } catch (err) {
    // 启动阶段任何异常都在状态栏可见，避免留下半初始化却看似"打不开"的界面
    setStatus(`初始化失败：${err instanceof Error ? err.message : String(err)}`, 'bad')
  }
})()

// 告知 index.html 的兜底脚本：应用已就绪；同时清掉自动刷新用的 _r 参数
app.setAttribute('data-booted', '1')
try {
  const url = new URL(location.href)
  if (url.searchParams.has('_r')) {
    url.searchParams.delete('_r')
    history.replaceState(null, '', url.pathname + url.search + url.hash)
  }
} catch {
  /* URL 不可用时忽略 */
}

// 便于调试
;(window as unknown as { __diandeng: unknown }).__diandeng = {
  validate,
  planLogicSolve,
  solvePuzzle,
  countSolutions,
  getSession: () => session,
  puzzles: library,
}
