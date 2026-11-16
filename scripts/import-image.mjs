/**
 * 点灯（Light Up / Akari）题面图片导入（全自动识图版）
 *
 * 用法：
 *   node scripts/import-image.mjs <图片路径> [--width N] [--height N] [--name 名称]
 *                                  [--series 识图] [--append] [--verify] [--json out.json]
 *                                  [--map "x,y=字符,..."] [--digits 01234] [--invert] [--dry]
 *                                  [--timeout 秒]
 *
 * 流程：
 *   1. Playwright + Edge 打开图片到 canvas，取灰度像素；
 *   2. 按行/列投影暗像素，多阈值扫描 + 等距序列拟合，自动判定网格（支持非正方形）；
 *   3. 每格取四角底色判定「墙 / 空地」，再对格子中心做自适应二值化 + 多字体模板匹配识别数字；
 *   4. 用「数字出现在哪种底色上」自动判定墙上/墙下极性（--invert 可强制反转），
 *      生成题面串：'.' = 空地，'#' = 无数字墙，'0'-'4' = 数字墙；
 *   5. 预览识别结果；--verify 调项目 solver 检查唯一解并求参考解（超时只告警）；
 *   6. --append 写入 src/game/imported-puzzles.ts（不会被 npm run gen 覆盖）。
 *
 * --map：人工覆盖某格，坐标 0 基（列,行），值取 . # 0 1 2 3 4，例如 --map "3,4=#,5,1=2"。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright-core'

// 项目 solver（src/types.ts）用了 const enum，Node 的类型擦除模式不能直接加载，
// 这里用 --experimental-transform-types 重新执行自己（npm run import-image 已带该参数）。
if (!process.execArgv.includes('--experimental-transform-types') && !process.env.LIGHTUP_IMPORT_REEXEC) {
  const ret = spawnSync(
    process.execPath,
    [
      '--experimental-transform-types',
      '--disable-warning=ExperimentalWarning',
      ...process.argv.slice(1),
    ],
    { stdio: 'inherit', env: { ...process.env, LIGHTUP_IMPORT_REEXEC: '1' } },
  )
  process.exit(ret.status ?? 1)
}

/** 无数字墙（与 src/types.ts 的 WALL 一致） */
const WALL = -1

const EDGE_CANDIDATES = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean)

function edgePath() {
  for (const c of EDGE_CANDIDATES) {
    if (c && existsSync(c)) return c
  }
  throw new Error('找不到 Edge 可执行文件，请用 EDGE_PATH 指定')
}

const args = process.argv.slice(2)
function has(flag) {
  return args.includes(flag)
}
function arg(flag, fallback = '') {
  const i = args.indexOf(flag)
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback
}
function argEq(flag) {
  for (const a of args) if (a.startsWith(flag + '=')) return a.slice(flag.length + 1)
  return null
}

const VALUE_FLAGS = ['--map', '--json', '--name', '--series', '--digits', '--width', '--height', '--timeout']
const imageArg = args.find((a, i) => {
  if (a.startsWith('--')) return false
  // 被“取值型”参数占用的下一个 token 不算图片
  const prev = args[i - 1]
  return !(prev && VALUE_FLAGS.includes(prev))
})
if (!imageArg) {
  console.error(
    '用法：node scripts/import-image.mjs <图片路径> [--width N] [--height N] [--name 名称] [--series 识图] [--append] [--verify] [--json out.json] [--map "x,y=字符,..."] [--digits 01234] [--invert] [--dry] [--timeout 秒]',
  )
  process.exit(1)
}
const IMAGE = path.resolve(imageArg)
if (!existsSync(IMAGE)) {
  console.error('找不到图片:', IMAGE)
  process.exit(1)
}

const widthOpt = Number(arg('--width', '0')) || 0
const heightOpt = Number(arg('--height', '0')) || 0
const nameOpt = arg('--name')
const series = arg('--series', '识图')
const jsonOut = arg('--json')
const digitSet = [...new Set([...arg('--digits', '01234')])].filter((c) => /[0-9]/.test(c))
const invert = has('--invert')
const append = has('--append')
const verify = has('--verify')
const dry = has('--dry')
const timeoutSec = Number(arg('--timeout', '0')) || 0

// --map "x,y=ch,..."
const manual = new Map()
const mapArg = argEq('--map') ?? arg('--map')
if (mapArg) {
  const re = /(\d+)\s*,\s*(\d+)\s*=\s*([.#0-9]+)/g
  let matched = 0
  let m
  while ((m = re.exec(mapArg)) !== null) {
    manual.set(Number(m[2]) * 10000 + Number(m[1]), m[3])
    matched++
  }
  const residue = mapArg.replace(re, '').replace(/[\s,;]+/g, '')
  if (!matched || residue) {
    console.error(`--map 格式错误：${mapArg}（应为 x,y=字符，多格用空格或分号分隔）`)
    process.exit(1)
  }
}

// ───────────────────────── 浏览器端识图 ─────────────────────────
const dataUrl = `data:image/png;base64,${readFileSync(IMAGE).toString('base64')}`
const browser = await chromium.launch({ headless: true, executablePath: edgePath() })
const page = await browser.newPage()
await page.setContent('<canvas id="c"></canvas>')

const analysis = await page.evaluate(
  async ({ dataUrl, widthOpt, heightOpt, digitSet }) => {
    const img = new Image()
    img.src = dataUrl
    await img.decode()
    const W = img.naturalWidth
    const H = img.naturalHeight
    const cv = document.createElement('canvas')
    cv.width = W
    cv.height = H
    const ctx = cv.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(img, 0, 0)
    const px = ctx.getImageData(0, 0, W, H).data
    const gray = (x, y) => {
      if (x < 0 || y < 0 || x >= W || y >= H) return 255
      const i = (y * W + x) * 4
      return 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]
    }
    const grayArr = new Float32Array(W * H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) grayArr[y * W + x] = gray(x, y)

    // 1) 暗像素投影 → 候选网格线中心
    const LINE_DARK = 165
    const colCount = new Int32Array(W)
    const rowCount = new Int32Array(H)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (grayArr[y * W + x] >= LINE_DARK) continue
        colCount[x]++
        rowCount[y]++
      }
    }
    const clustersOf = (counts, threshold) => {
      const out = []
      let start = -1
      for (let i = 0; i < counts.length; i++) {
        const on = counts[i] >= threshold
        if (on && start < 0) start = i
        if (!on && start >= 0) {
          out.push((start + i - 1) / 2)
          start = -1
        }
      }
      if (start >= 0) out.push((start + counts.length - 1) / 2)
      return out
    }
    /** 枚举等距最长序列（容差 15%），按覆盖格数降序 */
    const bestRun = (lines, wantCells) => {
      const out = []
      for (let i = 0; i < lines.length; i++) {
        for (let j = i + 1; j < lines.length; j++) {
          const step = (lines[j] - lines[i]) / (j - i)
          if (step < 8) continue
          let end = i
          for (let k = i + 1; k < lines.length; k++) {
            if (Math.abs(lines[k] - (lines[i] + step * (k - i))) > step * 0.15) break
            end = k
          }
          if (end - i >= 1) out.push({ start: i, end, step, count: end - i + 1 })
        }
      }
      out.sort((a, b) => b.count - a.count || a.step - b.step)
      if (wantCells >= 2) {
        const hit = out.find((r) => r.count - 1 === wantCells)
        if (hit) return hit
      }
      return out[0] ?? null
    }
    /** 多阈值扫描：挑「等距序列覆盖簇最多」的阈值，避免黑色色块污染投影 */
    const detectAxis = (counts, len, wantCells) => {
      let best = null
      for (const f of [0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6, 0.55, 0.5, 0.45, 0.4, 0.35]) {
        const lines = clustersOf(counts, len * f)
        if (lines.length < 3) continue
        const run = bestRun(lines, wantCells)
        if (!run) continue
        const fitted = run.count
        const score = fitted * (fitted / lines.length) * (wantCells >= 2 && fitted - 1 === wantCells ? 1.5 : 1)
        if (!best || score > best.score) best = { score, lines, run, threshold: f }
      }
      if (!best) return null
      return {
        lines: best.lines.slice(best.run.start, best.run.end + 1),
        step: (best.lines[best.run.end] - best.lines[best.run.start]) / (best.run.count - 1),
        threshold: best.threshold,
        clusters: best.lines.length,
      }
    }
    const xAxis = detectAxis(colCount, H, widthOpt)
    const yAxis = detectAxis(rowCount, W, heightOpt)
    if (!xAxis || !yAxis) throw new Error('图片里没有找到网格线')
    let xs = xAxis.lines
    let ys = yAxis.lines
    let cols = xs.length - 1
    let rows = ys.length - 1
    if (widthOpt >= 2 && cols !== widthOpt) {
      throw new Error(`网格宽度不匹配：识别到 ${cols} 列，--width ${widthOpt}`);
    }
    if (heightOpt >= 2 && rows !== heightOpt) {
      throw new Error(`网格高度不匹配：识别到 ${rows} 行，--height ${heightOpt}`);
    }
    if (cols < 2 || rows < 2) throw new Error(`识别到的网格太小：${cols}×${rows}`)
    const cellX = (xs[cols] - xs[0]) / cols
    const cellY = (ys[rows] - ys[0]) / rows

    // 2) 数字模板：多字体多字重，归一化 24×24
    const NS = 24
    const SRC = 40
    const normBit = (raw, T) => {
      let x0 = SRC
      let y0 = SRC
      let x1 = -1
      let y1 = -1
      let ink = 0
      const m = new Uint8Array(SRC * SRC)
      for (let j = 0; j < SRC; j++) {
        for (let i = 0; i < SRC; i++) {
          if (raw[j * SRC + i] >= T) continue
          m[j * SRC + i] = 1
          ink++
          if (i < x0) x0 = i
          if (i > x1) x1 = i
          if (j < y0) y0 = j
          if (j > y1) y1 = j
        }
      }
      if (!ink) return null
      const bw = x1 - x0 + 1
      const bh = y1 - y0 + 1
      const out = new Uint8Array(NS * NS)
      for (let j = 0; j < NS; j++) {
        for (let i = 0; i < NS; i++) {
          out[j * NS + i] = m[(y0 + Math.floor((bh * j) / NS)) * SRC + (x0 + Math.floor((bw * i) / NS))] ? 1 : 0
        }
      }
      return { m: out, ink, bw, bh }
    }
    const holesOf = (m) => {
      const seen = new Uint8Array(NS * NS)
      let holes = 0
      for (let j = 0; j < NS; j++) {
        for (let i = 0; i < NS; i++) {
          if (m[j * NS + i] || seen[j * NS + i]) continue
          let touches = false
          const st = [[i, j]]
          seen[j * NS + i] = 1
          while (st.length) {
            const [x, y] = st.pop()
            if (x === 0 || y === 0 || x === NS - 1 || y === NS - 1) touches = true
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const nx = x + dx
              const ny = y + dy
              if (nx < 0 || ny < 0 || nx >= NS || ny >= NS) continue
              if (seen[ny * NS + nx] || m[ny * NS + nx]) continue
              seen[ny * NS + nx] = 1
              st.push([nx, ny])
            }
          }
          if (!touches) holes++
        }
      }
      return holes
    }
    const tc = document.createElement('canvas')
    tc.width = 120
    tc.height = 120
    const tg = tc.getContext('2d', { willReadFrequently: true })
    const FONTS = [
      '700 84px Arial',
      '400 84px Arial',
      '700 84px "Segoe UI"',
      '400 84px "Segoe UI"',
      '700 84px Verdana',
      '700 84px Tahoma',
      '700 84px Consolas',
      '400 84px Consolas',
      '600 84px "Cascadia Code"',
      '400 84px "Cascadia Code"',
      '400 84px "Microsoft YaHei"',
      '700 84px "Microsoft YaHei"',
      '700 84px "Trebuchet MS"',
    ]
    const templates = {}
    for (const ch of digitSet) templates[ch] = []
    for (const font of FONTS) {
      for (const ch of digitSet) {
        tg.fillStyle = '#fff'
        tg.fillRect(0, 0, 120, 120)
        tg.fillStyle = '#000'
        tg.font = font
        tg.textAlign = 'center'
        tg.textBaseline = 'middle'
        tg.fillText(ch, 60, 60)
        const data = tg.getImageData(0, 0, 120, 120).data
        const raw = new Float32Array(SRC * SRC)
        for (let j = 0; j < SRC; j++) {
          for (let i = 0; i < SRC; i++) {
            const sx = Math.floor((i * 120) / SRC)
            const sy = Math.floor((j * 120) / SRC)
            raw[j * SRC + i] = data[(sy * 120 + sx) * 4]
          }
        }
        const gl = normBit(raw, 128)
        if (gl) templates[ch].push({ m: gl.m, holes: holesOf(gl.m) })
      }
    }
    const simShift = (a, b) => {
      let best = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          let inter = 0
          let union = 0
          for (let j = 0; j < NS; j++) {
            const bj = j + dy
            for (let i = 0; i < NS; i++) {
              const av = a[j * NS + i]
              const bi = i + dx
              const bv = bj >= 0 && bj < NS && bi >= 0 && bi < NS ? b[bj * NS + bi] : 0
              if (av && bv) inter++
              if (av || bv) union++
            }
          }
          const s = union ? inter / union : 0
          if (s > best) best = s
        }
      }
      return best
    }
    const medianOf = (arr) => {
      const s = Array.from(arr).sort((a, b) => a - b)
      return s[Math.floor(s.length / 2)]
    }
    const patchMedian = (cx, cy, half) => {
      const vals = []
      for (let dy = -half; dy <= half; dy++) {
        for (let dx = -half; dx <= half; dx++) {
          vals.push(gray(Math.round(cx + dx), Math.round(cy + dy)))
        }
      }
      return medianOf(vals)
    }

    // 3) 每格：底色 + 数字识别
    const cells = []
    const warnings = []
    const digitCrops = []
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x0 = xs[col]
        const x1 = xs[col + 1]
        const y0 = ys[row]
        const y1 = ys[row + 1]
        const cw = x1 - x0
        const ch = y1 - y0
        // 四角底色（数字在格心，四角不会被数字污染）
        const pad = 0.16
        const corners = [
          patchMedian(x0 + cw * pad, y0 + ch * pad, Math.max(1, Math.round(cw * 0.06))),
          patchMedian(x1 - cw * pad, y0 + ch * pad, Math.max(1, Math.round(cw * 0.06))),
          patchMedian(x0 + cw * pad, y1 - ch * pad, Math.max(1, Math.round(cw * 0.06))),
          patchMedian(x1 - cw * pad, y1 - ch * pad, Math.max(1, Math.round(cw * 0.06))),
        ]
        const fill = medianOf(corners)
        const fillDark = fill < 110
        // 中心裁切 72%
        const mx = x0 + cw * 0.14
        const my = y0 + ch * 0.14
        const mw = cw * 0.72
        const mh = ch * 0.72
        const raw = new Float32Array(SRC * SRC)
        for (let j = 0; j < SRC; j++) {
          for (let i = 0; i < SRC; i++) {
            raw[j * SRC + i] = gray(
              Math.round(mx + (mw * i) / (SRC - 1)),
              Math.round(my + (mh * j) / (SRC - 1)),
            )
          }
        }
        // 数字颜色跟着底色走：深色墙上是白字，浅色墙上是黑字
        const inkIsDark = fill > 110
        const T = inkIsDark ? fill - 60 : 255 - (fill + 60)
        const gl = inkIsDark ? normBit(raw, T) : normBit(raw.map((v) => 255 - v), T)
        let digit = null
        let scores = null
        let margin = 0
        if (gl && gl.ink >= 8 && gl.bw <= SRC * 0.9 && gl.bh <= SRC * 0.9 && gl.bw >= SRC * 0.12) {
          const holes = holesOf(gl.m)
          scores = {}
          for (const d of digitSet) {
            let best = 0
            for (const t of templates[d]) {
              let s = simShift(gl.m, t.m)
              if (t.holes === holes) s += 0.1
              else if (Math.abs(t.holes - holes) >= 2) s -= 0.12
              if (s > best) best = s
            }
            scores[d] = Number(best.toFixed(4))
          }
          const ranked = digitSet.map((d) => ({ d, score: scores[d] })).sort((a, b) => b.score - a.score)
          digit = ranked[0].d
          margin = ranked[0].score - (ranked[1]?.score ?? 0)
          if (ranked[0].score < 0.42) {
            warnings.push(
              `格 (${col},${row}) 数字置信度低：${digit} ${ranked[0].score.toFixed(2)}（可 --map 修正）`,
            )
          }
          digitCrops.push({ col, row, bw: gl.bw, bh: gl.bh, ink: gl.ink, score: ranked[0].score })
        }
        cells.push({
          col,
          row,
          fill: Number(fill.toFixed(1)),
          fillDark,
          digit,
          score: scores ? Number(Math.max(...Object.values(scores)).toFixed(4)) : 0,
          margin: Number(margin.toFixed(4)),
        })
      }
    }
    return {
      W,
      H,
      cols,
      rows,
      xs,
      ys,
      cellX: Number(cellX.toFixed(2)),
      cellY: Number(cellY.toFixed(2)),
      xThreshold: xAxis.threshold,
      yThreshold: yAxis.threshold,
      cells,
      warnings,
    }
  },
  { dataUrl, widthOpt, heightOpt, digitSet },
)

await browser.close()

const { cols, rows, cells } = analysis
const at = (col, row) => cells[row * cols + col]

// ───────────────────────── 极性（墙的底色）判定 ─────────────────────────
const numbered = cells.filter((c) => c.digit)
let wallDark
if (invert) {
  wallDark = true
} else if (numbered.length) {
  const darkCount = numbered.filter((c) => c.fillDark).length
  wallDark = darkCount * 2 >= numbered.length
} else {
  // 没有数字时假定「黑格是墙」（常见印刷风）；--invert 可反转
  const darkCount = cells.filter((c) => c.fillDark).length
  wallDark = darkCount * 3 < cells.length
}
if (numbered.length && numbered.some((c) => c.fillDark !== wallDark)) {
  const n = numbered.filter((c) => c.fillDark !== wallDark).length
  analysis.warnings.push(`有 ${n} 个数字不在墙底色上（可能的误识别，已在题面里按墙处理）`)
}
console.log(
  `[import] ${path.basename(IMAGE)}：${analysis.W}×${analysis.H}px，识别网格 ${cols}×${rows}，` +
    `格距 ${analysis.cellX}×${analysis.cellY}px，墙底色=${wallDark ? '深' : '浅'}` +
    `（投影阈值 x=${analysis.xThreshold} y=${analysis.yThreshold}）`,
)

// ───────────────────────── 生成题面串 ─────────────────────────
let board = new Array(cols * rows)
for (const c of cells) {
  const isWall = c.digit ? true : c.fillDark === wallDark
  board[c.row * cols + c.col] = isWall ? (c.digit ?? '#') : '.'
}
for (const [key, value] of manual) {
  const x = key % 10000
  const y = Math.floor(key / 10000)
  if (x >= cols || y >= rows) {
    console.error(`--map 坐标越界：${x},${y}（网格 ${cols}×${rows}）`)
    process.exit(1)
  }
  board[y * cols + x] = value
  console.log(`[import] 人工覆盖 (${x},${y}) = ${value}`)
}
const boardText = board.join('')
const wallCount = board.filter((v) => v !== '.').length
const clueCount = board.filter((v) => v !== '.' && v !== '#').length
const dist = new Map()
for (const v of board) if (v !== '.') dist.set(v, (dist.get(v) ?? 0) + 1)
console.log(
  `[import] 墙 ${wallCount}/${cols * rows}（其中数字墙 ${clueCount}）：` +
    `${[...dist].map(([d, n]) => `${d}×${n}`).join(' ')}`,
)
console.log('[import] 识别结果（# 无数字墙，. 空地）：')
for (let y = 0; y < rows; y++) {
  console.log('  ' + String(y).padStart(2) + ' ' + board.slice(y * cols, y * cols + cols).join(''))
}
if (analysis.warnings.length) {
  console.log(`[import] 注意 ${analysis.warnings.length} 条：`)
  for (const w of analysis.warnings.slice(0, 25)) console.log('  - ' + w)
  if (analysis.warnings.length > 25) console.log(`  … 其余 ${analysis.warnings.length - 25} 条略`)
}

// ───────────────────────── 校验 / 求解 ─────────────────────────
const clueCells = board.map((ch) => {
  if (ch === '.') return null
  if (ch === '#') return WALL
  return Number(ch)
})
if (clueCells.some((c) => c !== null && c !== WALL && (c < 0 || c > 4))) {
  console.error('[import] 出现 0-4 之外的数字，请用 --map 修正后重跑')
  process.exit(1)
}
const puzzle = {
  id: 'import-temp',
  name: nameOpt || `识图 · ${cols}×${rows}`,
  width: cols,
  height: rows,
  cells: clueCells,
  difficulty: 'custom',
}
let solutionText = ''
let unique = null
if (verify || append) {
  const { countSolutions, solvePuzzle } = await import('../src/solver.ts')
  const t0 = Date.now()
  const timeBudgetMs = timeoutSec ? timeoutSec * 1000 : 25_000
  const counted = countSolutions(puzzle, 2, { maxNodes: 6_000_000, timeBudgetMs })
  if (counted.timedOut) {
    console.warn(`[import] 唯一性检查超时（${counted.nodes} 节点 / ${Date.now() - t0}ms），仅告警`)
  } else if (counted.count !== 1) {
    console.warn(`[import] 解不唯一：找到 ${counted.count} 个（可能是识别错误，可用 --map 修正）`)
  } else {
    unique = true
    const solved = solvePuzzle(puzzle, { maxNodes: 3_000_000, timeBudgetMs })
    if (solved.solution) {
      solutionText = solved.solution.cells.map((v) => (v === 1 ? 'o' : '.')).join('')
      console.log(`[import] 项目 solver 校验：唯一解 ✓（${Date.now() - t0}ms，${counted.nodes} 节点）`)
    } else {
      console.warn('[import] 唯一解存在但 solver 没求出解（超时），参考解留空')
    }
  }
  if (unique && solutionText) {
    console.log('[import] 参考解（o = 灯泡）：')
    for (let y = 0; y < rows; y++) {
      console.log('  ' + solutionText.slice(y * cols, y * cols + cols))
    }
  }
} else {
  console.log('[import] 未加 --verify：跳过唯一性校验。')
}

// ───────────────────────── 导出 / 写入 ─────────────────────────
const id = `diandeng-import-${Date.now().toString(36)}`
const name = nameOpt || `识图 · ${cols}×${rows}`
if (jsonOut) {
  const file = path.resolve(jsonOut)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(
    file,
    JSON.stringify(
      {
        width: cols,
        height: rows,
        cells: boardText,
        solution: solutionText || null,
        unique,
        wallDark,
        source: path.basename(IMAGE),
      },
      null,
      2,
    ) + '\n',
  )
  console.log(`[import] 已导出 JSON：${file}`)
}

if (append) {
  if (dry) {
    console.log('[import] --dry：跳过写入')
  } else if (unique === false) {
    console.warn('[import] 未确认唯一解，仍按题面写入（参考解留空），建议先用 --map 修正')
  } else {
    const entry =
      `  { id: ${JSON.stringify(id)}, name: ${JSON.stringify(name)}, width: ${cols}, height: ${rows}, ` +
      `difficulty: "custom", series: ${JSON.stringify(series)}, cells: ${JSON.stringify(boardText)}, ` +
      `solution: ${JSON.stringify(solutionText)} },\n`
    const dataFile = path.resolve('src/imported-puzzles.ts')
    if (!existsSync(dataFile)) {
      writeFileSync(dataFile, `import type { RawPuzzle } from './puzzles-data'\n\nexport const IMPORTED_PUZZLES: RawPuzzle[] = [\n${entry}]\n`)
    } else {
      let text = readFileSync(dataFile, 'utf8').replace(/\r\n/g, '\n')
      if (/=\s*\[\s*\]/.test(text)) {
        // 空数组：直接填进去
        text = text.replace(/=\s*\[\s*\]/, () => '= [\n' + entry + ']')
      } else {
        const marker = text.lastIndexOf('\n]')
        if (marker < 0) throw new Error('imported-puzzles.ts 格式异常：找不到结尾 ]')
        text = text.slice(0, marker + 1) + entry + text.slice(marker + 1)
      }
      writeFileSync(dataFile, text)
    }
    console.log(`[import] 已写入 ${dataFile}：${id} ${name}`)
    console.log('[import] 提示：导入题写在 imported-puzzles.ts，不会被 npm run gen 覆盖。')
  }
} else {
  console.log('[import] 预览模式（未写入）。加 --append 写入 src/game/imported-puzzles.ts。')
}
