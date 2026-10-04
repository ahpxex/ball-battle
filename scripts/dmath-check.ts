/**
 * Accuracy and determinism check for src/game/core/dmath.ts.
 *
 *   bun run scripts/dmath-check.ts [--no-bench]
 *
 * Compares every dmath function against the native Math one (max ulp error,
 * bit mismatches, explicit spec special cases) and prints FNV-1a hashes of the
 * outputs for a deterministic input set. To prove cross-engine bit-identity,
 * bundle and run the same file under JavaScriptCore and V8:
 *
 *   bun build scripts/dmath-check.ts --target=node --outfile=/tmp/dmath-check.js
 *   bun /tmp/dmath-check.js && node /tmp/dmath-check.js
 *
 * The `dmath` hash lines must be identical; the `native` ones may differ.
 */
import * as dm from '../src/game/core/dmath'

const engine = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined' ? 'bun (JavaScriptCore)' : 'node (V8)'
const bench = !process.argv.includes('--no-bench')

// ---------------------------------------------------------------------------
// Bit helpers (DataView with explicit big-endian order: independent of host)

const dv = new DataView(new ArrayBuffer(8))
const hiOf = (x: number): number => {
  dv.setFloat64(0, x)
  return dv.getUint32(0)
}
const loOf = (x: number): number => {
  dv.setFloat64(0, x)
  return dv.getUint32(4)
}
const fromBits = (hi: number, lo: number): number => {
  dv.setUint32(0, hi >>> 0)
  dv.setUint32(4, lo >>> 0)
  return dv.getFloat64(0)
}
/** Exact 2^e for normal exponents (no `**`: input sets must not depend on the engine). */
const p2 = (e: number): number => fromBits((e + 1023) << 20, 0)
const hex = (x: number): string =>
  `0x${hiOf(x).toString(16).padStart(8, '0')}${loOf(x).toString(16).padStart(8, '0')}`

/** Ordered integer index of a double: adjacent doubles differ by 1 (+0 and -0 both map to 0). */
function ordered(x: number): bigint {
  dv.setFloat64(0, x)
  const bits = dv.getBigUint64(0)
  const mag = bits & 0x7fffffffffffffffn
  return bits >> 63n ? -mag : mag
}

/** Step x by k ulps along the ordered line of doubles (finite x only). */
function ulpStep(x: number, k: number): number {
  const idx = ordered(x) + BigInt(k)
  dv.setBigUint64(0, idx < 0n ? -idx | 0x8000000000000000n : idx)
  return dv.getFloat64(0)
}

/** Distance in ulps between two doubles (NaN == NaN, +0 == -0 here). */
function ulpDiff(a: number, b: number): number {
  if (a !== a || b !== b) return a !== a && b !== b ? 0 : Infinity
  const d = ordered(a) - ordered(b)
  return Number(d < 0n ? -d : d)
}

/** Bit-identical, treating every NaN as the same value. */
const same = (a: number, b: number): boolean => (a !== a && b !== b) || Object.is(a, b)

// ---------------------------------------------------------------------------
// FNV-1a over the float64 bit patterns (NaN canonicalised), integer ops only

class Fnv {
  h = 0x811c9dc5
  word(w: number): void {
    for (let s = 24; s >= 0; s -= 8) this.h = Math.imul(this.h ^ ((w >>> s) & 0xff), 0x01000193) >>> 0
  }
  num(x: number): void {
    if (x !== x) {
      this.word(0x7ff80000)
      this.word(0)
    } else {
      this.word(hiOf(x))
      this.word(loOf(x))
    }
  }
  hex(): string {
    return this.h.toString(16).padStart(8, '0')
  }
}

// ---------------------------------------------------------------------------
// Deterministic inputs (mulberry32 + exact 53-bit uniforms)

let seed = 0x5eed1234
function u32(): number {
  let t = (seed = (seed + 0x6d2b79f5) >>> 0)
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return (t ^ (t >>> 14)) >>> 0
}
const unit = (): number => ((u32() >>> 5) * 67108864 + (u32() >>> 6)) / 9007199254740992
const uni = (lo: number, hi: number): number => lo + (hi - lo) * unit()
const intIn = (lo: number, hi: number): number => lo + Math.floor(unit() * (hi - lo + 1))
/** Random mantissa, binary exponent uniform in [e0, e1]; e < -1022 gives subnormals. */
function logUni(e0: number, e1: number, signed = true): number {
  const e = intIn(e0, e1)
  const sign = signed && u32() & 1 ? 0x80000000 : 0
  if (e < -1022) {
    // subnormal: random bit pattern with the top set bit at position e + 1074
    const bits = e + 1074 // 0..51
    const hiBits = bits >= 32 ? bits - 32 : -1
    const hi = hiBits >= 0 ? (u32() & ((1 << hiBits) - 1)) | (1 << hiBits) : 0
    const lo = hiBits >= 0 ? u32() : (u32() & (bits === 31 ? 0x7fffffff : (1 << bits) - 1)) | (1 << bits)
    return fromBits(sign | hi, lo >>> 0)
  }
  return fromBits(sign | ((e + 1023) << 20) | (u32() & 0xfffff), u32())
}
const subnormal = (): number => fromBits((u32() & 1 ? 0x80000000 : 0) | (u32() & 0xfffff), u32())
const fill = (n: number, gen: () => number): number[] => Array.from({ length: n }, gen)
/** n tuples, flattened. */
const fillT = (n: number, gen: () => number[]): number[] => Array.from({ length: n }, gen).flat()

const SPECIAL = [
  NaN, 0, -0, Infinity, -Infinity, Number.MIN_VALUE, -Number.MIN_VALUE, Number.MAX_VALUE, -Number.MAX_VALUE,
  2.2250738585072014e-308, -2.2250738585072014e-308, 1, -1, 0.5, -0.5, 2, -2, 3, -3, 1e-300, -1e-300, 1e300, -1e300,
  Math.PI, -Math.PI, Math.PI / 2, -Math.PI / 2, Math.PI / 4, 1.5, -1.5, 0.1, -0.1,
]

// ---------------------------------------------------------------------------
// Exact reference: a small BigInt big-float (value = m * 2^e, ~420 bits) used to
// decide who is right whenever dmath and the native function disagree.

interface BF {
  m: bigint
  e: number
}
const PREC = 420
const bitlen = (m: bigint): number => (m === 0n ? 0 : (m < 0n ? -m : m).toString(2).length)
function bfn(m: bigint, e: number): BF {
  const l = bitlen(m)
  return l > PREC ? { m: m >> BigInt(l - PREC), e: e + l - PREC } : { m, e }
}
/** Exact big-float of a double; +-Infinity maps to +-2^1024 (the overflow boundary). */
function bf(x: number): BF {
  if (x === Infinity || x === -Infinity) return { m: x > 0 ? 1n : -1n, e: 1024 }
  dv.setFloat64(0, x)
  const b = dv.getBigUint64(0)
  const be = Number((b >> 52n) & 0x7ffn)
  const m = be ? (b & 0xfffffffffffffn) | (1n << 52n) : b & 0xfffffffffffffn
  return { m: b >> 63n ? -m : m, e: (be || 1) - 1075 }
}
const ONE: BF = { m: 1n, e: 0 }
const topBit = (a: BF): number => (a.m === 0n ? -Infinity : a.e + bitlen(a.m))
function add(a: BF, b: BF): BF {
  if (a.m === 0n) return b
  if (b.m === 0n) return a
  const d = topBit(a) - topBit(b)
  if (d > PREC + 8) return a
  if (d < -PREC - 8) return b
  return a.e >= b.e ? bfn((a.m << BigInt(a.e - b.e)) + b.m, b.e) : bfn(a.m + (b.m << BigInt(b.e - a.e)), a.e)
}
const neg = (a: BF): BF => ({ m: -a.m, e: a.e })
const sub = (a: BF, b: BF): BF => add(a, neg(b))
const mul = (a: BF, b: BF): BF => bfn(a.m * b.m, a.e + b.e)
function div(a: BF, b: BF): BF {
  const sh = Math.max(0, PREC + 8 + bitlen(b.m) - bitlen(a.m))
  return bfn((a.m << BigInt(sh)) / b.m, a.e - sh - b.e)
}
const divInt = (a: BF, k: number): BF => div(a, { m: BigInt(k), e: 0 })
const mulInt = (a: BF, k: number): BF => bfn(a.m * BigInt(k), a.e)
const gt = (a: BF, b: BF): boolean => sub(a, b).m > 0n
const negligible = (term: BF, sum: BF): boolean => term.m === 0n || topBit(term) < topBit(sum) - PREC - 4
function isqrt(n: bigint): bigint {
  if (n < 2n) return n
  let x = 1n << BigInt((bitlen(n) >> 1) + 1)
  for (;;) {
    const y = (x + n / x) >> 1n
    if (y >= x) return x
    x = y
  }
}
function sqrtBF(a: BF): BF {
  let sh = Math.max(0, 2 * PREC + 8 - bitlen(a.m))
  if ((a.e - sh) & 1) sh++
  return bfn(isqrt(a.m << BigInt(sh)), (a.e - sh) / 2)
}
/** Rough value, only for printing error sizes. */
function approx(a: BF): number {
  const l = bitlen(a.m)
  const k = Math.max(0, l - 60)
  return Number(a.m >> BigInt(k)) * Math.pow(2, a.e + k)
}

// pi and ln2 as 1700-bit fixed point (enough to reduce any double mod pi/2)
const FIX = 1700
const FONE = 1n << BigInt(FIX)
function atanInvFix(n: bigint): bigint {
  let sum = 0n
  let term = FONE / n
  const n2 = n * n
  for (let k = 1n, sign = 1n; term !== 0n; k += 2n, sign = -sign, term /= n2) sum += (sign * term) / k
  return sum
}
const PI_FIX = 16n * atanInvFix(5n) - 4n * atanInvFix(239n)
const PIO2_FIX = PI_FIX >> 1n
let ln2Fix = 0n
for (let k = 1n, p = 3n; FONE / p !== 0n; k += 2n, p *= 9n) ln2Fix += FONE / (k * p)
ln2Fix *= 2n // ln2 = 2 atanh(1/3)
const PI_BF = bfn(PI_FIX, -FIX)
const PIO2_BF = bfn(PIO2_FIX, -FIX)
const LN2_BF = bfn(ln2Fix, -FIX)

/** x = q*(pi/2) + r with |r| <= pi/4, q in 0..3. */
function reducePio2(x: number): { q: number; r: BF } {
  const b = bf(x)
  const m = b.m < 0n ? -b.m : b.m
  const X = m << BigInt(b.e + FIX)
  const k = (2n * X + PIO2_FIX) / (2n * PIO2_FIX)
  let r = bfn(X - k * PIO2_FIX, -FIX)
  let q = Number(k & 3n)
  if (b.m < 0n) {
    r = neg(r)
    q = (4 - q) & 3
  }
  return { q, r }
}
function sinS(x: BF): BF {
  const x2 = mul(x, x)
  let term = x
  let sum = x
  for (let i = 1; ; i++) {
    term = neg(divInt(mul(term, x2), 2 * i * (2 * i + 1)))
    if (negligible(term, sum)) return sum
    sum = add(sum, term)
  }
}
function cosS(x: BF): BF {
  const x2 = mul(x, x)
  let term = ONE
  let sum = ONE
  for (let i = 1; ; i++) {
    term = neg(divInt(mul(term, x2), (2 * i - 1) * (2 * i)))
    if (negligible(term, sum)) return sum
    sum = add(sum, term)
  }
}
function expBF(x: BF): BF {
  const k = Math.round(approx(x) / Math.LN2)
  const r = sub(x, mulInt(LN2_BF, k))
  let term = ONE
  let sum = ONE
  for (let i = 1; ; i++) {
    term = divInt(mul(term, r), i)
    if (negligible(term, sum)) return { m: sum.m, e: sum.e + k }
    sum = add(sum, term)
  }
}
function logBF(x: number): BF {
  const b = bf(x)
  const l = bitlen(b.m)
  let k = b.e + l - 1
  let f: BF = { m: b.m, e: 1 - l } // in [1, 2)
  if (Number(b.m >> BigInt(l - 30)) / 536870912 > Math.SQRT2) {
    f = { m: f.m, e: f.e - 1 }
    k++
  }
  const z = div(sub(f, ONE), add(f, ONE))
  const z2 = mul(z, z)
  let pw = z
  let sum = z
  for (let i = 1; ; i++) {
    pw = mul(pw, z2)
    const term = divInt(pw, 2 * i + 1)
    if (negligible(term, sum)) break
    sum = add(sum, term)
  }
  return add(mulInt(sum, 2), mulInt(LN2_BF, k))
}
function atanBF(x: BF): BF {
  if (x.m < 0n) return neg(atanBF(neg(x)))
  if (gt(x, ONE)) return sub(PIO2_BF, atanBF(div(ONE, x)))
  let t = x
  for (let i = 0; i < 3; i++) t = div(t, add(ONE, sqrtBF(add(ONE, mul(t, t))))) // halve the angle
  const t2 = mul(t, t)
  let pw = t
  let sum = t
  for (let i = 1; ; i++) {
    pw = neg(mul(pw, t2))
    const term = divInt(pw, 2 * i + 1)
    if (negligible(term, sum)) break
    sum = add(sum, term)
  }
  return mulInt(sum, 8)
}
const asinBF = (x: number): BF => atanBF(div(bf(x), sqrtBF(sub(ONE, mul(bf(x), bf(x))))))

const REF: Record<string, (a: number[]) => BF> = {
  sin: ([x]) => {
    const { q, r } = reducePio2(x)
    return [sinS(r), cosS(r), neg(sinS(r)), neg(cosS(r))][q]
  },
  cos: ([x]) => {
    const { q, r } = reducePio2(x)
    return [cosS(r), neg(sinS(r)), neg(cosS(r)), sinS(r)][q]
  },
  tan: ([x]) => {
    const { q, r } = reducePio2(x)
    return q & 1 ? neg(div(cosS(r), sinS(r))) : div(sinS(r), cosS(r))
  },
  asin: ([x]) => asinBF(x),
  acos: ([x]) => sub(PIO2_BF, asinBF(x)),
  atan: ([x]) => atanBF(bf(x)),
  atan2: ([y, x]) => {
    if (x === 0) return y > 0 ? PIO2_BF : neg(PIO2_BF)
    const a = atanBF(div(bf(y), bf(x)))
    return x > 0 ? a : y >= 0 ? add(a, PI_BF) : sub(a, PI_BF)
  },
  exp: ([x]) => expBF(bf(x)),
  log: ([x]) => logBF(x),
  pow: ([x, y]) => {
    const r = expBF(mul(bf(y), logBF(Math.abs(x))))
    return x < 0 && Math.abs(y % 2) === 1 ? neg(r) : r
  },
  hypot: ([x, y]) => sqrtBF(add(mul(bf(x), bf(x)), mul(bf(y), bf(y)))),
  hypot3: ([x, y, z]) => sqrtBF(add(add(mul(bf(x), bf(x)), mul(bf(y), bf(y))), mul(bf(z), bf(z)))),
}

/** Signed error of `out` against the exact value, in ulps of `out`. */
function ulpErr(out: number, exact: BF): number {
  dv.setFloat64(0, Math.abs(out))
  const be = Number((dv.getBigUint64(0) >> 52n) & 0x7ffn)
  const d = sub(bf(out), exact)
  return approx({ m: d.m, e: d.e - ((be || 1) - 1075) })
}

// ---------------------------------------------------------------------------
// Comparison bookkeeping

interface Stats {
  name: string
  n: number
  mismatch: number
  maxUlp: number
  worst: string
  specialN: number
  specialMismatch: number
  over1: number // disagreements > 1 ulp
  judged: number // disagreements checked against the exact reference
  dmErr: number // max |error| of dmath vs exact, in ulps, over judged cases
  natErr: number // same for native
  dmWorst: string
  dmErrOver1: number // max |error| of dmath over the >1-ulp disagreements
}

const dmTotal = new Fnv()
const nativeTotal = new Fnv()
const rows: Stats[] = []
const hashRows: string[] = []

type Fn = (...args: number[]) => number

/** Every >1-ulp disagreement is judged against the exact value, plus this many 1-ulp ones. */
const SAMPLE_1ULP = 400

/** inputs: flat array of tuples of `arity` numbers; specials compared bit-exactly. */
function check(name: string, arity: number, dmf: Fn, nat: Fn, inputs: number[], specials: number[]): void {
  const st: Stats = {
    name, n: 0, mismatch: 0, maxUlp: 0, worst: '', specialN: 0, specialMismatch: 0,
    over1: 0, judged: 0, dmErr: 0, natErr: 0, dmWorst: '', dmErrOver1: 0,
  }
  const hd = new Fnv()
  const hn = new Fnv()
  const args: number[] = new Array(arity)
  const ref = REF[name]
  const describe = (a: number, b: number): string =>
    `(${args.map((v) => `${v} [${hex(v)}]`).join(', ')}) dm=${a} native=${b}`
  const run = (arr: number[], special: boolean): void => {
    for (let i = 0; i < arr.length; i += arity) {
      for (let k = 0; k < arity; k++) args[k] = arr[i + k]
      const a = dmf(...args)
      const b = nat(...args)
      hd.num(a)
      hn.num(b)
      dmTotal.num(a)
      nativeTotal.num(b)
      st.n++
      if (special) st.specialN++
      if (same(a, b)) continue
      st.mismatch++
      const d = ulpDiff(a, b)
      // a signed-zero or NaN-vs-number difference is a spec failure, not rounding
      if (d === 0 || d === Infinity) {
        st.specialMismatch++
        st.worst = describe(a, b)
        continue
      }
      if (d > st.maxUlp) {
        st.maxUlp = d
        st.worst = describe(a, b)
      }
      if (d > 1) st.over1++
      // judge every >1 ulp disagreement and an even sample of the 1-ulp ones
      if (d > 1 || st.mismatch % 97 === 0 && st.judged < st.over1 + SAMPLE_1ULP) {
        const exact = ref(args)
        const ea = Math.abs(ulpErr(a, exact))
        const eb = Math.abs(ulpErr(b, exact))
        st.judged++
        if (ea > st.dmErr) {
          st.dmErr = ea
          st.dmWorst = describe(a, b)
        }
        st.natErr = Math.max(st.natErr, eb)
        if (d > 1) st.dmErrOver1 = Math.max(st.dmErrOver1, ea)
      }
    }
  }
  run(inputs, false)
  run(specials, true)
  rows.push(st)
  hashRows.push(`${name.padEnd(8)} dmath=${hd.hex()} native=${hn.hex()}`)
}

const cross = (xs: number[], ys: number[]): number[] => xs.flatMap((x) => ys.flatMap((y) => [x, y]))

// ---------------------------------------------------------------------------
// Input sets

// trig: typical, large, near multiples of pi/2, huge (Payne-Hanek), tiny
const nearPio2: number[] = []
for (let k = 1; k <= 256; k++) for (let d = -3; d <= 3; d++) nearPio2.push(ulpStep(k * (Math.PI / 2), d), -ulpStep(k * (Math.PI / 2), d))
for (let i = 0; i < 40000; i++) nearPio2.push(ulpStep(intIn(-2000000, 2000000) * (Math.PI / 2), intIn(-4, 4)))
for (let i = 0; i < 10000; i++) nearPio2.push(ulpStep(intIn(1, 1e9) * Math.PI, intIn(-2, 2)))
const hugeTrig = [
  1e22, -1e22, 1e300, -1e300, 1e308, Number.MAX_VALUE, -Number.MAX_VALUE, 8.98846567431158e307, 1e15, 1e16, 1e17,
  1e18, 1e19, 1e20, 1e21, 1e23, 1e50, 1e100, 1e200, p2(60), p2(100), p2(500), p2(1000), 6381956970095103 * p2(797),
  5.319372648326541e255, 3.4e38, 1048576 * (Math.PI / 2), 1647099.3291652855, 1647099.329165286,
]
const trigInputs = [
  ...fill(200000, () => uni(-10, 10)),
  ...fill(100000, () => uni(-1000, 1000)),
  ...fill(100000, () => uni(-1e6, 1e6)),
  ...fill(100000, () => logUni(-30, 1023)),
  ...fill(20000, () => logUni(-1074, -20)),
  ...fill(5000, subnormal),
  ...nearPio2,
  ...hugeTrig,
]

const asinInputs = [
  ...fill(300000, () => uni(-1, 1)),
  ...fill(50000, () => (u32() & 1 ? -1 : 1) * (1 - logUni(-53, -1, false))),
  ...fill(30000, () => uni(-0.52, 0.52)),
  ...fill(20000, () => (u32() & 1 ? -1 : 1) * uni(0.97, 0.98)),
  ...fill(30000, () => logUni(-1074, -1)),
  ...fill(10000, () => uni(-10, 10)),
]

const atanInputs = [
  ...fill(200000, () => uni(-10, 10)),
  ...fill(50000, () => uni(-1e6, 1e6)),
  ...fill(100000, () => logUni(-1074, 1023)),
  ...[0.4375, 0.6875, 1.1875, 2.4375, p2(66), p2(-27)].flatMap((b) => fill(5000, () => (u32() & 1 ? -b : b) * uni(0.999, 1.001))),
]

const atan2Inputs = [
  ...fill(400000, () => uni(-10, 10)),
  ...fill(100000, () => uni(-1000, 1000)),
  ...fill(200000, () => logUni(-1074, 1023)),
  ...fillT(20000, () => [uni(-10, 10), 1]),
  ...fillT(20000, () => [uni(-1, 1), uni(-1, 1) * p2(-70)]),
  ...fillT(20000, () => [uni(-1, 1) * p2(-70), uni(-1, 1)]),
]

const expInputs = [
  ...fill(200000, () => uni(-745.2, 709.8)),
  ...fill(100000, () => uni(-10, 10)),
  ...fill(50000, () => logUni(-1074, -1)),
  ...fill(20000, () => uni(708, 710)),
  ...fill(20000, () => uni(-746, -707)),
  ...fill(20000, () => uni(-0.6, 0.6)),
]

const logInputs = [
  ...fill(200000, () => uni(0, 10)),
  ...fill(150000, () => logUni(-1074, 1023, false)),
  ...fill(50000, () => 1 + uni(-1, 1) * p2(-intIn(1, 52))),
  ...fill(5000, () => uni(-10, 0)),
]

const powInputs = [
  ...fillT(200000, () => [uni(0, 10), uni(-10, 10)]),
  ...fillT(50000, () => [uni(-10, 0), intIn(-50, 50)]),
  ...fillT(100000, () => [logUni(-20, 20, false), uni(-100, 100)]),
  ...fillT(50000, () => [logUni(-1074, 1023, false), uni(-4, 4)]),
  ...fillT(20000, () => [1 + uni(-1, 1) * p2(-25), (u32() & 1 ? -1 : 1) * uni(p2(31), p2(40))]),
  ...fillT(20000, () => [uni(0.5, 2), uni(-1100, 1100)]),
  ...fillT(10000, () => [-uni(0.5, 2), intIn(-1100, 1100)]),
]

const hypotInputs = [
  ...fill(400000, () => uni(-10, 10)),
  ...fill(100000, () => uni(-1000, 1000)),
  ...fill(200000, () => logUni(-1074, 1023)),
  ...fillT(20000, () => [uni(-1, 1) * 1e300, uni(-1, 1) * 1e300]),
  ...fillT(20000, () => [uni(-1, 1) * 1e-300, uni(-1, 1) * 1e-300]),
  ...fillT(10000, () => [uni(-1, 1), uni(-1, 1) * p2(-66)]),
]

const hypot3Inputs = [
  ...fill(600000, () => uni(-10, 10)),
  ...fill(150000, () => logUni(-1074, 1023)),
  ...fill(30000, () => uni(-1, 1) * 1e300),
  ...fill(30000, () => uni(-1, 1) * 1e-300),
]
const tripleSpecial = [NaN, 0, -0, Infinity, -Infinity, 1, -2, Number.MAX_VALUE, Number.MIN_VALUE, 1e-300]
const cross3 = tripleSpecial.flatMap((a) => tripleSpecial.flatMap((b) => tripleSpecial.flatMap((c) => [a, b, c])))

const POW_X = [
  NaN, 0, -0, Infinity, -Infinity, 1, -1, 0.5, -0.5, 2, -2, 3, -3, 1.0000001, 0.9999999, Number.MIN_VALUE,
  -Number.MIN_VALUE, Number.MAX_VALUE, -Number.MAX_VALUE, 10, -10,
]
const POW_Y = [
  NaN, 0, -0, Infinity, -Infinity, 1, -1, 2, -2, 3, -3, 0.5, -0.5, 2.5, -2.5, 1e300, -1e300, p2(53) + 2, p2(53) - 1,
  -(p2(53) - 1), 1023, 1024, 1075, -1075, -1074, p2(31) + 1, p2(64) + p2(12),
]

// ---------------------------------------------------------------------------
// Run

const unary: [string, Fn, Fn, number[]][] = [
  ['sin', dm.sin as Fn, Math.sin as Fn, trigInputs],
  ['cos', dm.cos as Fn, Math.cos as Fn, trigInputs],
  ['tan', dm.tan as Fn, Math.tan as Fn, trigInputs],
  ['asin', dm.asin as Fn, Math.asin as Fn, asinInputs],
  ['acos', dm.acos as Fn, Math.acos as Fn, asinInputs],
  ['atan', dm.atan as Fn, Math.atan as Fn, atanInputs],
  ['exp', dm.exp as Fn, Math.exp as Fn, expInputs],
  ['log', dm.log as Fn, Math.log as Fn, logInputs],
]
for (const [name, f, g, inputs] of unary) check(name, 1, f, g, inputs, SPECIAL)
check('atan2', 2, dm.atan2 as Fn, Math.atan2 as Fn, atan2Inputs, cross(SPECIAL, SPECIAL))
check('pow', 2, dm.pow as Fn, Math.pow as Fn, powInputs, [...cross(POW_X, POW_Y), ...cross(SPECIAL, SPECIAL)])
check('hypot', 2, ((x, y) => dm.hypot(x, y)) as Fn, ((x, y) => Math.hypot(x, y)) as Fn, hypotInputs, cross(SPECIAL, SPECIAL))
check('hypot3', 3, ((x, y, z) => dm.hypot(x, y, z)) as Fn, ((x, y, z) => Math.hypot(x, y, z)) as Fn, hypot3Inputs, cross3)

// Explicit spec special cases (ECMA-262 Math.* / Number::exponentiate), checked bit-exactly.
const P = Math.PI
const spec: [string, number, number][] = [
  ['sin(NaN)', dm.sin(NaN), NaN], ['sin(-0)', dm.sin(-0), -0], ['sin(+0)', dm.sin(0), 0], ['sin(inf)', dm.sin(Infinity), NaN],
  ['sin(-inf)', dm.sin(-Infinity), NaN], ['cos(-0)', dm.cos(-0), 1], ['cos(inf)', dm.cos(Infinity), NaN],
  ['cos(NaN)', dm.cos(NaN), NaN], ['tan(-0)', dm.tan(-0), -0], ['tan(-inf)', dm.tan(-Infinity), NaN],
  ['asin(-0)', dm.asin(-0), -0], ['asin(1.5)', dm.asin(1.5), NaN], ['asin(1)', dm.asin(1), P / 2], ['asin(-1)', dm.asin(-1), -P / 2],
  ['acos(1)', dm.acos(1), 0], ['acos(-1)', dm.acos(-1), P], ['acos(-1.5)', dm.acos(-1.5), NaN], ['acos(NaN)', dm.acos(NaN), NaN],
  ['atan(-0)', dm.atan(-0), -0], ['atan(inf)', dm.atan(Infinity), P / 2], ['atan(-inf)', dm.atan(-Infinity), -P / 2],
  ['atan2(+0,+0)', dm.atan2(0, 0), 0], ['atan2(+0,-0)', dm.atan2(0, -0), P], ['atan2(-0,+0)', dm.atan2(-0, 0), -0],
  ['atan2(-0,-0)', dm.atan2(-0, -0), -P], ['atan2(+0,-1)', dm.atan2(0, -1), P], ['atan2(-0,-1)', dm.atan2(-0, -1), -P],
  ['atan2(+0,1)', dm.atan2(0, 1), 0], ['atan2(-0,1)', dm.atan2(-0, 1), -0], ['atan2(1,+0)', dm.atan2(1, 0), P / 2],
  ['atan2(1,-0)', dm.atan2(1, -0), P / 2], ['atan2(-1,+0)', dm.atan2(-1, 0), -P / 2], ['atan2(1,inf)', dm.atan2(1, Infinity), 0],
  ['atan2(-1,inf)', dm.atan2(-1, Infinity), -0], ['atan2(1,-inf)', dm.atan2(1, -Infinity), P], ['atan2(-1,-inf)', dm.atan2(-1, -Infinity), -P],
  ['atan2(inf,1)', dm.atan2(Infinity, 1), P / 2], ['atan2(-inf,1)', dm.atan2(-Infinity, 1), -P / 2],
  ['atan2(inf,inf)', dm.atan2(Infinity, Infinity), P / 4], ['atan2(inf,-inf)', dm.atan2(Infinity, -Infinity), (3 * P) / 4],
  ['atan2(-inf,inf)', dm.atan2(-Infinity, Infinity), -P / 4], ['atan2(-inf,-inf)', dm.atan2(-Infinity, -Infinity), (-3 * P) / 4],
  ['atan2(NaN,1)', dm.atan2(NaN, 1), NaN], ['atan2(1,NaN)', dm.atan2(1, NaN), NaN],
  ['exp(NaN)', dm.exp(NaN), NaN], ['exp(-0)', dm.exp(-0), 1], ['exp(inf)', dm.exp(Infinity), Infinity], ['exp(-inf)', dm.exp(-Infinity), 0],
  ['exp(1000)', dm.exp(1000), Infinity], ['exp(-1000)', dm.exp(-1000), 0],
  ['log(NaN)', dm.log(NaN), NaN], ['log(-1)', dm.log(-1), NaN], ['log(+0)', dm.log(0), -Infinity], ['log(-0)', dm.log(-0), -Infinity],
  ['log(1)', dm.log(1), 0], ['log(inf)', dm.log(Infinity), Infinity], ['log(-inf)', dm.log(-Infinity), NaN],
  ['pow(2,NaN)', dm.pow(2, NaN), NaN], ['pow(1,NaN)', dm.pow(1, NaN), NaN], ['pow(NaN,0)', dm.pow(NaN, 0), 1],
  ['pow(NaN,-0)', dm.pow(NaN, -0), 1], ['pow(NaN,1)', dm.pow(NaN, 1), NaN], ['pow(inf,0.1)', dm.pow(Infinity, 0.1), Infinity],
  ['pow(inf,-0.1)', dm.pow(Infinity, -0.1), 0], ['pow(-inf,3)', dm.pow(-Infinity, 3), -Infinity], ['pow(-inf,2)', dm.pow(-Infinity, 2), Infinity],
  ['pow(-inf,2.5)', dm.pow(-Infinity, 2.5), Infinity], ['pow(-inf,-3)', dm.pow(-Infinity, -3), -0], ['pow(-inf,-2)', dm.pow(-Infinity, -2), 0],
  ['pow(+0,3)', dm.pow(0, 3), 0], ['pow(+0,-3)', dm.pow(0, -3), Infinity], ['pow(-0,3)', dm.pow(-0, 3), -0],
  ['pow(-0,2)', dm.pow(-0, 2), 0], ['pow(-0,-3)', dm.pow(-0, -3), -Infinity], ['pow(-0,-2)', dm.pow(-0, -2), Infinity],
  ['pow(-0,0.5)', dm.pow(-0, 0.5), 0], ['pow(-0,-0.5)', dm.pow(-0, -0.5), Infinity],
  ['pow(2,inf)', dm.pow(2, Infinity), Infinity], ['pow(1,inf)', dm.pow(1, Infinity), NaN], ['pow(-1,inf)', dm.pow(-1, Infinity), NaN],
  ['pow(0.5,inf)', dm.pow(0.5, Infinity), 0], ['pow(2,-inf)', dm.pow(2, -Infinity), 0], ['pow(1,-inf)', dm.pow(1, -Infinity), NaN],
  ['pow(-0.5,-inf)', dm.pow(-0.5, -Infinity), Infinity], ['pow(-2,0.5)', dm.pow(-2, 0.5), NaN], ['pow(-8,1/3)', dm.pow(-8, 1 / 3), NaN],
  ['pow(-2,3)', dm.pow(-2, 3), -8], ['pow(1,5)', dm.pow(1, 5), 1], ['pow(-1,2^53)', dm.pow(-1, p2(53)), 1],
  ['hypot(inf,NaN)', dm.hypot(Infinity, NaN), Infinity], ['hypot(NaN,-inf)', dm.hypot(NaN, -Infinity), Infinity],
  ['hypot(NaN,1)', dm.hypot(NaN, 1), NaN], ['hypot(-0,-0)', dm.hypot(-0, -0), 0], ['hypot(3,4)', dm.hypot(3, 4), 5],
  ['hypot(NaN,1,-inf)', dm.hypot(NaN, 1, -Infinity), Infinity], ['hypot(-0,-0,-0)', dm.hypot(-0, -0, -0), 0],
  ['hypot(1,2,NaN)', dm.hypot(1, 2, NaN), NaN], ['hypot(2,3,6)', dm.hypot(2, 3, 6), 7],
]
const specFails = spec.filter(([, got, want]) => !same(got, want))

// ---------------------------------------------------------------------------
// Report

console.log(`engine: ${engine}`)
console.log('')
console.log('max-ulp: largest dmath-vs-native difference. err: |error| vs the exact value (BigInt')
console.log('reference) over every >1-ulp disagreement plus a sample of 1-ulp ones.')
console.log('')
console.log('fn        inputs  mismatches  max-ulp     >1ulp  judged  dmath-err  native-err  special(n/bad)')
let dmErrOver1 = 0
let badSpecial = 0
for (const s of rows) {
  dmErrOver1 = Math.max(dmErrOver1, s.dmErrOver1)
  badSpecial += s.specialMismatch
  console.log(
    `${s.name.padEnd(8)} ${String(s.n).padStart(7)} ${String(s.mismatch).padStart(11)} ${String(s.maxUlp).padStart(8)}` +
      ` ${String(s.over1).padStart(9)} ${String(s.judged).padStart(7)} ${s.dmErr.toFixed(3).padStart(10)}` +
      ` ${s.natErr.toFixed(3).padStart(11)}  ${s.specialN}/${s.specialMismatch}`,
  )
}
console.log('')
for (const s of rows) {
  if (s.maxUlp > 1 || s.specialMismatch > 0) console.log(`largest diff ${s.name}: ${s.worst}`)
  if (s.dmErr > 0.75) console.log(`largest dmath err ${s.name}: ${s.dmWorst}`)
}
console.log(`explicit spec cases: ${spec.length - specFails.length}/${spec.length} pass`)
for (const [name, got, want] of specFails) console.log(`  FAIL ${name}: got ${Object.is(got, -0) ? '-0' : got}, want ${Object.is(want, -0) ? '-0' : want}`)
console.log('')
console.log('hashes (FNV-1a of float64 bits, NaN canonicalised):')
for (const line of hashRows) console.log(`  ${line}`)
console.log(`  TOTAL    dmath=${dmTotal.hex()} native=${nativeTotal.hex()}`)

// dmath must be < 1 ulp from the exact value wherever it disagrees with native by more than 1 ulp
const ok = dmErrOver1 < 1 && badSpecial === 0 && specFails.length === 0
console.log('')
console.log(
  ok
    ? 'PASS: special cases exact; every >1-ulp disagreement with native is a native error (dmath < 1 ulp from exact)'
    : 'FAIL',
)

// ---------------------------------------------------------------------------
// Micro-benchmark

if (bench) {
  const N = 1 << 10
  const angles = fill(N, () => uni(-10, 10))
  const xs = fill(N, () => uni(-100, 100))
  const ys = fill(N, () => uni(-100, 100))
  const ITER = 5_000_000
  const time1 = (f: (x: number) => number): number => {
    let acc = 0
    for (let i = 0; i < 200_000; i++) acc += f(angles[i & (N - 1)])
    const t0 = performance.now()
    for (let i = 0; i < ITER; i++) acc += f(angles[i & (N - 1)])
    const ns = ((performance.now() - t0) * 1e6) / ITER
    if (acc === 42.4242) console.log('')
    return ns
  }
  const time2 = (f: (x: number, y: number) => number): number => {
    let acc = 0
    for (let i = 0; i < 200_000; i++) acc += f(ys[i & (N - 1)], xs[i & (N - 1)])
    const t0 = performance.now()
    for (let i = 0; i < ITER; i++) acc += f(ys[i & (N - 1)], xs[i & (N - 1)])
    const ns = ((performance.now() - t0) * 1e6) / ITER
    if (acc === 42.4242) console.log('')
    return ns
  }
  const cases: [string, number, number][] = [
    ['sin', time1((x) => dm.sin(x)), time1((x) => Math.sin(x))],
    ['cos', time1((x) => dm.cos(x)), time1((x) => Math.cos(x))],
    ['tan', time1((x) => dm.tan(x)), time1((x) => Math.tan(x))],
    ['exp', time1((x) => dm.exp(x)), time1((x) => Math.exp(x))],
    ['atan2', time2((y, x) => dm.atan2(y, x)), time2((y, x) => Math.atan2(y, x))],
    ['hypot', time2((y, x) => dm.hypot(y, x)), time2((y, x) => Math.hypot(y, x))],
    ['pow', time2((y, x) => dm.pow(Math.abs(y), x * 0.05)), time2((y, x) => Math.pow(Math.abs(y), x * 0.05))],
  ]
  console.log('')
  console.log(`benchmark (${engine}, ns/call incl. loop overhead):`)
  for (const [name, a, b] of cases) console.log(`  ${name.padEnd(6)} dmath ${a.toFixed(1).padStart(6)}   native ${b.toFixed(1).padStart(6)}`)
}

if (!ok) process.exitCode = 1
