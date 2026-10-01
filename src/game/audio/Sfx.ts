import type { SoundId } from '../engine/types'

/** Minimum gap between two plays of the same sound, so rapid ticks don't pile up (s). */
const MIN_GAP: Partial<Record<SoundId, number>> = {
  bounce: 0.05,
  clack: 0.05,
  poison: 0.12,
  thread: 0.05,
  place: 0.05,
  heal: 0.08,
  drill: 0.08,
  shuriken: 0.04,
  throw: 0.06,
  roll: 0.04,
  zap: 0.06,
  laser: 0.05,
}

type Voice = (ctx: AudioContext, out: AudioNode, t: number, volume: number, pitch: number) => void

function tone(
  ctx: AudioContext,
  out: AudioNode,
  t: number,
  o: { type: OscillatorType; from: number; to?: number; dur: number; gain: number; attack?: number },
): void {
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.type = o.type
  osc.frequency.setValueAtTime(o.from, t)
  if (o.to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t + o.dur)
  const a = o.attack ?? 0.004
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(o.gain, t + a)
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur)
  osc.connect(g).connect(out)
  osc.start(t)
  osc.stop(t + o.dur + 0.02)
}

function noise(
  ctx: AudioContext,
  out: AudioNode,
  buffer: AudioBuffer,
  t: number,
  o: { dur: number; gain: number; filter: BiquadFilterType; freq: number; freqTo?: number; q?: number },
): void {
  const src = ctx.createBufferSource()
  src.buffer = buffer
  const f = ctx.createBiquadFilter()
  f.type = o.filter
  f.frequency.setValueAtTime(o.freq, t)
  if (o.freqTo !== undefined) f.frequency.exponentialRampToValueAtTime(o.freqTo, t + o.dur)
  f.Q.value = o.q ?? 1
  const g = ctx.createGain()
  g.gain.setValueAtTime(o.gain, t)
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur)
  src.connect(f).connect(g).connect(out)
  src.start(t, Math.random() * 0.5)
  src.stop(t + o.dur + 0.02)
}

/**
 * Tiny synthesized sound kit — no audio assets needed. The AudioContext is
 * created lazily on the first user gesture (browsers block autoplay).
 */
export class Sfx {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noiseBuffer: AudioBuffer | null = null
  private lastPlayed = new Map<SoundId, number>()
  private voices: Record<SoundId, Voice>
  muted = false
  volume = 0.5

  constructor() {
    const nb = () => this.noiseBuffer!
    this.voices = {
      start: (c, o, t, v) => {
        tone(c, o, t, { type: 'square', from: 523, dur: 0.1, gain: 0.12 * v })
        tone(c, o, t + 0.1, { type: 'square', from: 784, dur: 0.18, gain: 0.12 * v })
      },
      bounce: (c, o, t, v, p) => tone(c, o, t, { type: 'sine', from: 420 * p, to: 300 * p, dur: 0.05, gain: 0.08 * v }),
      clack: (c, o, t, v, p) => noise(c, o, nb(), t, { dur: 0.05, gain: 0.25 * v, filter: 'bandpass', freq: 1900 * p, q: 3 }),
      hit: (c, o, t, v) => {
        tone(c, o, t, { type: 'square', from: 240, to: 110, dur: 0.09, gain: 0.1 * v })
        noise(c, o, nb(), t, { dur: 0.06, gain: 0.2 * v, filter: 'highpass', freq: 1200 })
      },
      heavyHit: (c, o, t, v) => {
        tone(c, o, t, { type: 'square', from: 150, to: 55, dur: 0.16, gain: 0.14 * v })
        noise(c, o, nb(), t, { dur: 0.14, gain: 0.3 * v, filter: 'lowpass', freq: 2200, freqTo: 400 })
      },
      bite: (c, o, t, v) => {
        noise(c, o, nb(), t, { dur: 0.07, gain: 0.3 * v, filter: 'bandpass', freq: 900, q: 2 })
        tone(c, o, t, { type: 'triangle', from: 320, to: 160, dur: 0.08, gain: 0.1 * v })
      },
      heal: (c, o, t, v) => tone(c, o, t, { type: 'sine', from: 660, to: 990, dur: 0.12, gain: 0.07 * v, attack: 0.01 }),
      spike: (c, o, t, v) => {
        tone(c, o, t, { type: 'triangle', from: 900, to: 420, dur: 0.09, gain: 0.12 * v })
        noise(c, o, nb(), t, { dur: 0.05, gain: 0.15 * v, filter: 'highpass', freq: 2500 })
      },
      place: (c, o, t, v, p) => tone(c, o, t, { type: 'sine', from: 600 * p, to: 760 * p, dur: 0.06, gain: 0.06 * v }),
      thread: (c, o, t, v) => tone(c, o, t, { type: 'sine', from: 1600, to: 1300, dur: 0.07, gain: 0.06 * v }),
      hook: (c, o, t, v) => {
        noise(c, o, nb(), t, { dur: 0.08, gain: 0.25 * v, filter: 'bandpass', freq: 2600, q: 4 })
        tone(c, o, t, { type: 'square', from: 300, to: 140, dur: 0.08, gain: 0.08 * v })
      },
      whoosh: (c, o, t, v, p) => noise(c, o, nb(), t, { dur: 0.22, gain: 0.18 * v, filter: 'bandpass', freq: 400 * p, freqTo: 1800 * p, q: 1.5 }),
      trainHorn: (c, o, t, v, p) => {
        for (const f of [233, 294]) tone(c, o, t, { type: 'sawtooth', from: f * p, dur: 0.55, gain: 0.05 * v, attack: 0.04 })
      },
      trainHit: (c, o, t, v) => {
        noise(c, o, nb(), t, { dur: 0.18, gain: 0.35 * v, filter: 'lowpass', freq: 1500, freqTo: 200 })
        tone(c, o, t, { type: 'square', from: 110, to: 50, dur: 0.15, gain: 0.12 * v })
      },
      poison: (c, o, t, v) => tone(c, o, t, { type: 'sine', from: 280, to: 200, dur: 0.07, gain: 0.05 * v }),
      shuriken: (c, o, t, v) => {
        tone(c, o, t, { type: 'triangle', from: 2200, to: 1400, dur: 0.06, gain: 0.07 * v })
        noise(c, o, nb(), t, { dur: 0.05, gain: 0.18 * v, filter: 'highpass', freq: 3000 })
      },
      throw: (c, o, t, v) => noise(c, o, nb(), t, { dur: 0.12, gain: 0.12 * v, filter: 'bandpass', freq: 1800, freqTo: 3200, q: 2 }),
      explosion: (c, o, t, v) => {
        noise(c, o, nb(), t, { dur: 0.45, gain: 0.45 * v, filter: 'lowpass', freq: 1800, freqTo: 120 })
        tone(c, o, t, { type: 'sine', from: 120, to: 40, dur: 0.35, gain: 0.2 * v })
      },
      hammer: (c, o, t, v) => {
        tone(c, o, t, { type: 'square', from: 110, to: 45, dur: 0.22, gain: 0.16 * v })
        noise(c, o, nb(), t, { dur: 0.2, gain: 0.35 * v, filter: 'lowpass', freq: 2500, freqTo: 300 })
        tone(c, o, t, { type: 'triangle', from: 1300, to: 900, dur: 0.15, gain: 0.05 * v })
      },
      drill: (c, o, t, v) => tone(c, o, t, { type: 'sawtooth', from: 180, to: 240, dur: 0.1, gain: 0.06 * v }),
      web: (c, o, t, v) => noise(c, o, nb(), t, { dur: 0.16, gain: 0.16 * v, filter: 'bandpass', freq: 3500, freqTo: 900, q: 3 }),
      chess: (c, o, t, v) => {
        tone(c, o, t, { type: 'triangle', from: 520, to: 380, dur: 0.07, gain: 0.12 * v })
        noise(c, o, nb(), t, { dur: 0.05, gain: 0.2 * v, filter: 'bandpass', freq: 1200, q: 4 })
      },
      roll: (c, o, t, v, p) => tone(c, o, t, { type: 'square', from: 900 * p, dur: 0.025, gain: 0.04 * v }),
      jackpot: (c, o, t, v) => {
        ;[523, 784, 1047, 1568].forEach((f, i) => tone(c, o, t + i * 0.06, { type: 'square', from: f, dur: 0.12, gain: 0.08 * v }))
      },
      zap: (c, o, t, v, p) => {
        noise(c, o, nb(), t, { dur: 0.12, gain: 0.22 * v, filter: 'highpass', freq: 2500 * p })
        tone(c, o, t, { type: 'sawtooth', from: 1200 * p, to: 300 * p, dur: 0.1, gain: 0.05 * v })
      },
      laser: (c, o, t, v, p) => tone(c, o, t, { type: 'sawtooth', from: 1800 * p, to: 1100 * p, dur: 0.05, gain: 0.04 * v }),
      thunder: (c, o, t, v) => {
        noise(c, o, nb(), t, { dur: 0.5, gain: 0.45 * v, filter: 'lowpass', freq: 2500, freqTo: 100 })
        noise(c, o, nb(), t, { dur: 0.08, gain: 0.3 * v, filter: 'highpass', freq: 3000 })
      },
      disarm: (c, o, t, v) => {
        tone(c, o, t, { type: 'square', from: 900, to: 300, dur: 0.18, gain: 0.06 * v })
      },
      death: (c, o, t, v) => {
        noise(c, o, nb(), t, { dur: 0.5, gain: 0.4 * v, filter: 'lowpass', freq: 3000, freqTo: 150 })
        tone(c, o, t, { type: 'square', from: 420, to: 50, dur: 0.45, gain: 0.12 * v })
      },
      win: (c, o, t, v) => {
        ;[523, 659, 784, 1047].forEach((f, i) => tone(c, o, t + i * 0.09, { type: 'square', from: f, dur: 0.16, gain: 0.09 * v }))
      },
    }
  }

  /** Call from a user gesture to unlock audio. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return
      this.ctx = new Ctor()
      this.master = this.ctx.createGain()
      this.master.gain.value = this.volume
      this.master.connect(this.ctx.destination)
      const len = this.ctx.sampleRate
      this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
      const data = this.noiseBuffer.getChannelData(0)
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }

  play(id: SoundId, volume = 1, pitch = 1): void {
    const ctx = this.ctx
    if (this.muted || !ctx || !this.master || ctx.state !== 'running') return
    const now = ctx.currentTime
    const gap = MIN_GAP[id] ?? 0.02
    const last = this.lastPlayed.get(id) ?? -1
    if (now - last < gap) return
    this.lastPlayed.set(id, now)
    this.voices[id](ctx, this.master, now, Math.min(1, volume), pitch)
  }
}

export const sfx = new Sfx()
