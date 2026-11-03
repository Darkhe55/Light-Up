/**
 * 点灯音效（Web Audio 合成，无外部资源）
 * - 放灯泡：明亮的「叮」+ 泛音（像灯亮起）
 * - 标 × / 取消：水滴
 * - 解出：上行琶音
 */

let ctx: AudioContext | null = null
let master: GainNode | null = null
let muted = false

function ac(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const C =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!C) return null
    ctx = new C()
    master = ctx.createGain()
    master.gain.value = 0.28
    master.connect(ctx.destination)
  }
  return ctx
}

export function setMuted(m: boolean): void {
  muted = m
  if (master) master.gain.value = m ? 0 : 0.28
}

export function isMuted(): boolean {
  return muted
}

export function resumeAudio(): void {
  const c = ac()
  if (c && c.state === 'suspended') void c.resume()
}

/** 连拍数 n → 半音偏移（1=0, 2=+2, 3=+4 …） */
function semitoneForStreak(n: number): number {
  const k = Math.max(1, Math.min(n, 12)) - 1
  return k * 2
}

function mul(semi: number): number {
  return Math.pow(2, semi / 12)
}

/** 水滴：音高快速下落 + 轻微噪声水花 */
function playDrop(streak = 1): void {
  const c = ac()
  if (!c || !master || muted) return
  const t = c.currentTime
  const k = mul(semitoneForStreak(streak))

  const osc = c.createOscillator()
  const g = c.createGain()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(760 * k, t)
  osc.frequency.exponentialRampToValueAtTime(240 * k, t + 0.14)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(0.5, t + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22)
  osc.connect(g)
  g.connect(master)
  osc.start(t)
  osc.stop(t + 0.28)
}

/** 点灯：清亮叮声 + 泛音（三角波，快速起振缓慢衰减） */
function playLamp(streak = 1): void {
  const c = ac()
  if (!c || !master || muted) return
  const t = c.currentTime
  const k = mul(semitoneForStreak(streak))
  const base = 660 * k

  const bus = c.createGain()
  bus.gain.value = 0.4
  bus.connect(master)

  const partials = [
    { mul: 1, amp: 0.5, decay: 0.5 },
    { mul: 2.01, amp: 0.2, decay: 0.34 },
    { mul: 3.02, amp: 0.08, decay: 0.22 },
  ]
  for (const p of partials) {
    const o = c.createOscillator()
    const g = c.createGain()
    o.type = 'triangle'
    o.frequency.value = base * p.mul
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(p.amp, t + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0001, t + p.decay + 0.12)
    o.connect(g)
    g.connect(bus)
    o.start(t)
    o.stop(t + p.decay + 0.18)
  }
}

/** 解出：上行琶音 */
export function playSolved(): void {
  const c = ac()
  if (!c || !master || muted) return
  const dest = master
  const t = c.currentTime
  const notes = [523.25, 659.25, 783.99, 1046.5]
  notes.forEach((f, i) => {
    const o = c.createOscillator()
    const g = c.createGain()
    o.type = 'triangle'
    o.frequency.value = f
    const t0 = t + i * 0.11
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(0.32, t0 + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.42)
    o.connect(g)
    g.connect(dest)
    o.start(t0)
    o.stop(t0 + 0.5)
  })
}

/** 落子音效：放灯泡 = 点灯，标 × = 水滴；streak 抬音高 */
export function playForCell(isBulb: boolean, streak = 1): void {
  resumeAudio()
  if (isBulb) playLamp(streak)
  else playDrop(streak)
}
