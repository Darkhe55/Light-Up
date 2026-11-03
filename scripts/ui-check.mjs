/**
 * 点灯 UI 冒烟测试（playwright-core + Edge/Chromium）
 * 用法：node scripts/ui-check.mjs [baseUrl]
 * 先起服务：npx vite preview --port 5179
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const BASE = process.argv[2] || 'http://127.0.0.1:5179/'
const OUT = 'output/playwright'
mkdirSync(OUT, { recursive: true })

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const launchOpts = { headless: true }
try {
  const { accessSync } = await import('node:fs')
  accessSync(EDGE)
  launchOpts.executablePath = EDGE
} catch {
  /* 用 playwright-core 自带浏览器 */
}

let failures = 0
const ok = (cond, msg) => {
  console.log(`${cond ? '✓' : '✗'} ${msg}`)
  if (!cond) failures++
}

const browser = await chromium.launch(launchOpts)
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`console: ${msg.text()}`)
})

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForSelector('#app[data-booted="1"]', { timeout: 15000 })

// 初始渲染
const puzzleCount = await page.locator('.puzzle-item').count()
const svgCount = await page.locator('svg.board-svg').count()
ok(puzzleCount >= 9, `题库渲染 ${puzzleCount} 题`)
ok(svgCount === 1, '棋盘 SVG 渲染')

const info = await page.evaluate(() => {
  const s = window.__diandeng.getSession()
  const whites = []
  for (let i = 0; i < s.puzzle.cells.length; i++) {
    if (s.puzzle.cells[i] === null) whites.push(i)
  }
  return {
    name: s.puzzle.name,
    w: s.puzzle.width,
    h: s.puzzle.height,
    whites,
    bulbs: s.state.cells.filter((c) => c === 1).length,
  }
})
ok(info.whites.length > 0, `题面「${info.name}」${info.w}×${info.h}，空地 ${info.whites.length} 格`)
await page.screenshot({ path: `${OUT}/01-initial.png`, fullPage: true })

// viewBox 坐标 → 屏幕坐标
const geom = await page.evaluate(() => {
  const svg = document.querySelector('svg.board-svg')
  const r = svg.getBoundingClientRect()
  return { x: r.x, y: r.y, vbW: svg.viewBox.baseVal.width, vbH: svg.viewBox.baseVal.height, w: r.width, h: r.height }
})
const CELL = 48
const PAD = 24
const clickCell = async (cx, cy) => {
  const vx = PAD + (cx + 0.5) * CELL
  const vy = PAD + (cy + 0.5) * CELL
  await page.mouse.click(geom.x + (vx / geom.vbW) * geom.w, geom.y + (vy / geom.vbH) * geom.h)
}

const firstWhite = info.whites[0]
const fcx = firstWhite % info.w
const fcy = Math.floor(firstWhite / info.w)

// 左键循环：空 → 灯泡 → × → 空
await clickCell(fcx, fcy)
await page.waitForTimeout(60)
let bulbs = await page.locator('.bulb').count()
ok(bulbs === 1, `左键放灯泡（.bulb=${bulbs}）`)

await clickCell(fcx, fcy)
await page.waitForTimeout(60)
let marks = await page.locator('.mark').count()
ok(marks === 1 && (await page.locator('.bulb').count()) === 0, `再点标 ×（.mark=${marks}）`)

await clickCell(fcx, fcy)
await page.waitForTimeout(60)
ok((await page.locator('.mark').count()) === 0, '第三次清空')

// 撤销 / 重做
await clickCell(fcx, fcy)
await page.waitForTimeout(50)
await page.click('#btn-undo')
await page.waitForTimeout(50)
ok((await page.locator('.bulb').count()) === 0, '撤销移除灯泡')
await page.click('#btn-redo')
await page.waitForTimeout(50)
ok((await page.locator('.bulb').count()) === 1, '重做恢复灯泡')
await page.screenshot({ path: `${OUT}/02-bulb.png`, fullPage: true })

// 检查（未完成时应给出问题描述）
await page.click('#btn-check')
await page.waitForTimeout(60)
const checkStatus = await page.locator('#status').innerText()
ok(checkStatus.length > 0, `检查状态：${checkStatus.slice(0, 40)}…`)

// 提示一格
await page.click('#btn-clear')
await page.waitForTimeout(50)
await page.click('#btn-hint')
await page.waitForTimeout(80)
const afterHint = await page.evaluate(() => {
  const s = window.__diandeng.getSession()
  return s.state.cells.filter((c) => c !== 0).length
})
ok(afterHint >= 1, `提示揭示 ${afterHint} 格`)

// 显示解 → 完成
await page.click('#btn-solve')
await page.waitForTimeout(150)
const solvedState = await page.evaluate(() => {
  const s = window.__diandeng.getSession()
  return window.__diandeng.validate(s.state, s.puzzle).solved
})
ok(solvedState === true, '显示解后盘面判定完成')
const solvedStatus = await page.locator('#status').innerText()
ok(solvedStatus.includes('参考解') || solvedStatus.includes('完成'), `完成状态：${solvedStatus.slice(0, 30)}…`)
await page.screenshot({ path: `${OUT}/03-solved.png`, fullPage: true })

// 逻辑解题回放
await page.click('#btn-clear')
await page.waitForTimeout(50)
await page.click('#btn-logic')
await page.waitForTimeout(300)
const logicBtnText1 = await page.locator('#btn-logic').innerText()
ok(logicBtnText1 === '停止回放', `逻辑回放中按钮=${logicBtnText1}`)
// 等回放结束（最多 30s）
for (let i = 0; i < 60; i++) {
  const t = await page.locator('#btn-logic').innerText()
  if (t === '逻辑解题') break
  await page.waitForTimeout(500)
}
const logicBtnText2 = await page.locator('#btn-logic').innerText()
ok(logicBtnText2 === '逻辑解题', `回放结束按钮=${logicBtnText2}`)
const logicStatus = await page.locator('#status').innerText()
console.log(`  逻辑回放状态：${logicStatus.slice(0, 60)}`)

// 随机抽题
await page.click('#btn-random')
await page.waitForTimeout(120)
const randomName = await page.evaluate(() => window.__diandeng.getSession().puzzle.name)
ok(typeof randomName === 'string' && randomName.length > 0, `随机抽题：${randomName}`)

// 自定义题板
await page.click('#btn-custom')
await page.waitForTimeout(60)
ok(await page.locator('#custom-editor').isVisible(), '自定义编辑器打开')
await page.fill('#custom-w', '5')
await page.fill('#custom-h', '5')
await page.click('#custom-regen')
await page.waitForTimeout(60)
const cellCount = await page.locator('.custom-cell').count()
ok(cellCount === 25, `自定义网格 25 格（实际 ${cellCount}）`)

// 搭一块可解题板：四角墙 + 中心数字 1（四邻都是空地，必然可解）
await page.locator('.custom-cell[data-i="0"]').click() // (0,0) 墙
await page.locator('.custom-cell[data-i="4"]').click() // (4,0) 墙
await page.locator('.custom-cell[data-i="20"]').click() // (0,4) 墙
await page.locator('.custom-cell[data-i="24"]').click() // (4,4) 墙
await page.locator('.custom-cell[data-i="12"]').click() // (2,2) → 墙
await page.locator('.custom-cell[data-i="12"]').click() // → 0
await page.locator('.custom-cell[data-i="12"]').click() // → 1
await page.waitForTimeout(50)
const label12 = await page.locator('.custom-cell[data-i="12"]').innerText()
ok(label12 === '1', `自定义格 (2,2) = ${label12}`)

await page.click('#custom-unique')
await page.waitForTimeout(300)
const uniqueMsg = await page.locator('#custom-msg').innerText()
ok(uniqueMsg.includes('唯一解') || uniqueMsg.includes('不唯一') || uniqueMsg.includes('无解'), `唯一解校验：${uniqueMsg}`)

await page.click('#custom-apply')
await page.waitForTimeout(150)
const customInfo = await page.evaluate(() => {
  const s = window.__diandeng.getSession()
  return { id: s.puzzle.id, name: s.puzzle.name, w: s.puzzle.width }
})
ok(customInfo.id.startsWith('custom-5x5'), `载入自定义题板：${customInfo.name}`)
const listHasCustom = await page.locator('.puzzle-item', { hasText: '自定义 · 5×5' }).count()
ok(listHasCustom >= 1, '自定义题进入题库列表')

// 自定义盘求解
await page.click('#custom-solve')
await page.waitForTimeout(500)
const customSolveMsg = await page.locator('#custom-msg').innerText()
ok(customSolveMsg.includes('求解成功') || customSolveMsg.includes('无解'), `自定义求解：${customSolveMsg}`)

// 缩放
await page.click('#zoom-in')
await page.waitForTimeout(50)
const zoomLabel = await page.locator('#zoom-label').innerText()
ok(zoomLabel !== '100%', `缩放 ${zoomLabel}`)
await page.click('#zoom-reset')
await page.waitForTimeout(50)

await page.screenshot({ path: `${OUT}/04-custom.png`, fullPage: true })

ok(errors.length === 0, `无页面错误${errors.length ? `：${errors.join(' | ')}` : ''}`)

await browser.close()
console.log('')
if (failures) {
  console.log(`失败 ${failures} 项`)
  process.exit(1)
}
console.log('冒烟测试全部通过')
