/**
 * Deterministic transcendental math.
 *
 * ECMAScript lets Math.sin/cos/tan/asin/acos/atan/atan2/exp/log/pow/hypot (and
 * the `**` operator) be implementation-approximated, so V8, JavaScriptCore and
 * SpiderMonkey return different last bits for the same input. The simulation
 * must be bit-identical in every browser and on the server referee, so every
 * outcome-affecting call goes through this module instead.
 *
 * Rule: only IEEE-754 basic ops (+ - * /, Math.sqrt), exact helpers (floor,
 * abs, ...) and integer/bitwise ops are allowed here. Never use the
 * approximated Math functions or `**` in this file.
 *
 * The algorithms are faithful ports of musl libc (fdlibm-derived): sin/cos/tan
 * with full Payne-Hanek reduction, asin, acos, atan, atan2, hypot, and the
 * fdlibm exp/log/pow, with JS special-case semantics where they differ from C
 * (pow(1, NaN), pow(+-1, +-inf)). Errors are below 1 ulp (atan2, like musl,
 * can reach ~1.1 ulp). JS doubles are strict binary64 with round-to-nearest
 * and no FMA contraction, so only the C integer semantics (int32 truncation,
 * uint32 wraparound, signed shifts) need care.
 *
 * Accuracy and cross-engine checks: scripts/dmath-check.ts.
 */

// Word access to doubles through one shared buffer (endianness detected once).
const wbuf = new ArrayBuffer(8)
const wf = new Float64Array(wbuf)
const wu = new Uint32Array(wbuf)
wf[0] = 1
const HI = wu[1] === 0x3ff00000 ? 1 : 0
const LO = 1 - HI

/** High 32 bits as uint32. */
function hiWord(x: number): number {
  wf[0] = x
  return wu[HI]
}

function fromWords(hi: number, lo: number): number {
  wu[HI] = hi
  wu[LO] = lo
  return wf[0]
}

function withHi(x: number, hi: number): number {
  wf[0] = x
  wu[HI] = hi
  return wf[0]
}

function withLo(x: number, lo: number): number {
  wf[0] = x
  wu[LO] = lo
  return wf[0]
}

const TWO24 = 16777216 // 0x1p24
const TWO_M24 = 5.960464477539063e-8 // 0x1p-24
const TWO53 = 9007199254740992 // 0x1p53
const TWO54 = 18014398509481984 // 0x1p54
const TWO700 = 5.260135901548374e210 // 0x1p700
const TWO_M700 = 1.90109156629516e-211 // 0x1p-700
const TWO1023 = 8.98846567431158e307 // 0x1p1023
const TWO_M969 = 2.004168360008973e-292 // 0x1p-1022 * 0x1p53
const TWO_M120 = 7.52316384526264e-37 // 0x1p-120

function scalbn(x: number, n: number): number {
  let y = x
  if (n > 1023) {
    y *= TWO1023
    n -= 1023
    if (n > 1023) {
      y *= TWO1023
      n -= 1023
      if (n > 1023) n = 1023
    }
  } else if (n < -1022) {
    // keep final n < -53 to avoid double rounding in the subnormal range
    y *= TWO_M969
    n += 1022 - 53
    if (n < -1022) {
      y *= TWO_M969
      n += 1022 - 53
      if (n < -1022) n = -1022
    }
  }
  return y * fromWords((0x3ff + n) << 20, 0)
}

// ---------------------------------------------------------------------------
// Kernels on [-pi/4, pi/4] (musl __sin, __cos, __tan)

const S1 = -0.16666666666666632 // 0xBFC55555 55555549
const S2 = 0.00833333333332249 // 0x3F811111 1110F8A6
const S3 = -0.0001984126982985795 // 0xBF2A01A0 19C161D5
const S4 = 0.0000027557313707070068 // 0x3EC71DE3 57B1FE7D
const S5 = -2.5050760253406863e-8 // 0xBE5AE5E6 8A2B9CEB
const S6 = 1.58969099521155e-10 // 0x3DE5D93A 5ACFD57C

function kSin(x: number, y: number, iy: number): number {
  const z = x * x
  const w = z * z
  const r = S2 + z * (S3 + z * S4) + z * w * (S5 + z * S6)
  const v = z * x
  if (iy === 0) return x + v * (S1 + z * r)
  return x - (z * (0.5 * y - v * r) - y - v * S1)
}

const C1 = 0.0416666666666666 // 0x3FA55555 5555554C
const C2 = -0.001388888888887411 // 0xBF56C16C 16C15177
const C3 = 0.00002480158728947673 // 0x3EFA01A0 19CB1590
const C4 = -2.7557314351390663e-7 // 0xBE927E4F 809C52AD
const C5 = 2.087572321298175e-9 // 0x3E21EE9E BDB4B1C4
const C6 = -1.1359647557788195e-11 // 0xBDA8FAE9 BE8838D4

function kCos(x: number, y: number): number {
  const z = x * x
  let w = z * z
  const r = z * (C1 + z * (C2 + z * C3)) + w * w * (C4 + z * (C5 + z * C6))
  const hz = 0.5 * z
  w = 1 - hz
  return w + (1 - w - hz + (z * r - x * y))
}

const T0 = 0.3333333333333341 // 0x3FD55555 55555563
const T1 = 0.13333333333320124 // 0x3FC11111 1110FE7A
const T2 = 0.05396825397622605 // 0x3FABA1BA 1BB341FE
const T3 = 0.021869488294859542 // 0x3F9664F4 8406D637
const T4 = 0.0088632398235993 // 0x3F8226E3 E96E8493
const T5 = 0.0035920791075913124 // 0x3F6D6D22 C9560328
const T6 = 0.0014562094543252903 // 0x3F57DBC8 FEE08315
const T7 = 0.0005880412408202641 // 0x3F4344D8 F2F26501
const T8 = 0.0002464631348184699 // 0x3F3026F7 1A8D1068
const T9 = 0.00007817944429395571 // 0x3F147E88 A03792A6
const T10 = 0.00007140724913826082 // 0x3F12B80F 32F0A7E9
const T11 = -0.000018558637485527546 // 0xBEF375CB DB605373
const T12 = 0.00002590730518636337 // 0x3EFB2A70 74BF7AD4
const PIO4 = 0.7853981633974483 // 0x3FE921FB 54442D18
const PIO4_LO = 3.061616997868383e-17 // 0x3C81A626 33145C07

function kTan(x: number, y: number, odd: number): number {
  const hx = hiWord(x)
  const big = (hx & 0x7fffffff) >= 0x3fe59428 // |x| >= 0.6744
  let sign = 0
  if (big) {
    sign = hx >>> 31
    if (sign) {
      x = -x
      y = -y
    }
    x = PIO4 - x + (PIO4_LO - y)
    y = 0
  }
  const z = x * x
  let w = z * z
  let r = T1 + w * (T3 + w * (T5 + w * (T7 + w * (T9 + w * T11))))
  let v = z * (T2 + w * (T4 + w * (T6 + w * (T8 + w * (T10 + w * T12)))))
  let s = z * x
  r = y + z * (s * (r + v) + y) + s * T0
  w = x + r
  if (big) {
    s = 1 - 2 * odd
    v = s - 2 * (x + (r - (w * w) / (w + s)))
    return sign ? -v : v
  }
  if (!odd) return w
  // -1/(x+r) has up to 2ulp error, so compute it accurately
  const w0 = withLo(w, 0)
  v = r - (w0 - x) // w0+v = r+x
  const a = -1 / w
  const a0 = withLo(a, 0)
  return a0 + a * (1 + a0 * w0 + a0 * v)
}

// ---------------------------------------------------------------------------
// Argument reduction x -> n*pi/2 + (ry0 + ry1) (musl __rem_pio2)

// Results of the reduction, kept module-level so the hot path never allocates.
let ry0 = 0
let ry1 = 0

const TOINT = 6755399441055744 // 1.5 / DBL_EPSILON
const INVPIO2 = 0.6366197723675814 // 0x3FE45F30 6DC9C883
const PIO2_1 = 1.5707963267341256 // 0x3FF921FB 54400000, first 33 bits of pi/2
const PIO2_1T = 6.077100506506192e-11 // 0x3DD0B461 1A626331, pi/2 - PIO2_1
const PIO2_2 = 6.077100506303966e-11 // 0x3DD0B461 1A600000, second 33 bits
const PIO2_2T = 2.0222662487959506e-21 // 0x3BA3198A 2E037073
const PIO2_3 = 2.0222662487111665e-21 // 0x3BA3198A 2E000000, third 33 bits
const PIO2_3T = 8.4784276603689e-32 // 0x397B839A 252049C1

function remPio2(x: number): number {
  const hx = hiWord(x)
  const sign = hx >>> 31
  const ix = hx & 0x7fffffff
  let z: number
  if (ix <= 0x400f6a7a) {
    // |x| ~<= 5pi/4
    if ((ix & 0xfffff) === 0x921fb) return remPio2Medium(x, ix) // |x| ~= pi/2 or pi
    if (ix <= 0x4002d97c) {
      // |x| ~<= 3pi/4
      if (!sign) {
        z = x - PIO2_1
        ry0 = z - PIO2_1T
        ry1 = z - ry0 - PIO2_1T
        return 1
      }
      z = x + PIO2_1
      ry0 = z + PIO2_1T
      ry1 = z - ry0 + PIO2_1T
      return -1
    }
    if (!sign) {
      z = x - 2 * PIO2_1
      ry0 = z - 2 * PIO2_1T
      ry1 = z - ry0 - 2 * PIO2_1T
      return 2
    }
    z = x + 2 * PIO2_1
    ry0 = z + 2 * PIO2_1T
    ry1 = z - ry0 + 2 * PIO2_1T
    return -2
  }
  if (ix <= 0x401c463b) {
    // |x| ~<= 9pi/4
    if (ix <= 0x4015fdbc) {
      // |x| ~<= 7pi/4
      if (ix === 0x4012d97c) return remPio2Medium(x, ix) // |x| ~= 3pi/2
      if (!sign) {
        z = x - 3 * PIO2_1
        ry0 = z - 3 * PIO2_1T
        ry1 = z - ry0 - 3 * PIO2_1T
        return 3
      }
      z = x + 3 * PIO2_1
      ry0 = z + 3 * PIO2_1T
      ry1 = z - ry0 + 3 * PIO2_1T
      return -3
    }
    if (ix === 0x401921fb) return remPio2Medium(x, ix) // |x| ~= 2pi
    if (!sign) {
      z = x - 4 * PIO2_1
      ry0 = z - 4 * PIO2_1T
      ry1 = z - ry0 - 4 * PIO2_1T
      return 4
    }
    z = x + 4 * PIO2_1
    ry0 = z + 4 * PIO2_1T
    ry1 = z - ry0 + 4 * PIO2_1T
    return -4
  }
  if (ix < 0x413921fb) return remPio2Medium(x, ix) // |x| ~< 2^20 * pi/2
  if (ix >= 0x7ff00000) {
    // inf or NaN
    ry0 = ry1 = x - x
    return 0
  }
  // Large: z = scalbn(|x|, -ilogb(x) + 23), split into three 24-bit chunks.
  wf[0] = x
  wu[HI] = (wu[HI] & 0xfffff) | ((0x3ff + 23) << 20)
  z = wf[0]
  let i = 0
  for (; i < 2; i++) {
    rpTx[i] = z | 0
    z = (z - rpTx[i]) * TWO24
  }
  rpTx[i] = z
  // skip zero terms, first term is non-zero
  while (rpTx[i] === 0) i--
  const n = remPio2Large((ix >>> 20) - (0x3ff + 23), i + 1)
  if (sign) {
    ry0 = -ry0
    ry1 = -ry1
    return -n
  }
  return n
}

function remPio2Medium(x: number, ix: number): number {
  // rint(x / (pi/2))
  let fn = x * INVPIO2 + TOINT - TOINT
  let n = fn | 0
  let r = x - fn * PIO2_1
  let w = fn * PIO2_1T // 1st round, good to 85 bits
  // matters only with directed rounding, kept for fidelity
  if (r - w < -PIO4) {
    n--
    fn--
    r = x - fn * PIO2_1
    w = fn * PIO2_1T
  } else if (r - w > PIO4) {
    n++
    fn++
    r = x - fn * PIO2_1
    w = fn * PIO2_1T
  }
  ry0 = r - w
  const ex = ix >>> 20
  let ey = (hiWord(ry0) >>> 20) & 0x7ff
  if (ex - ey > 16) {
    // 2nd round, good to 118 bits
    let t = r
    w = fn * PIO2_2
    r = t - w
    w = fn * PIO2_2T - (t - r - w)
    ry0 = r - w
    ey = (hiWord(ry0) >>> 20) & 0x7ff
    if (ex - ey > 49) {
      // 3rd round, good to 151 bits, covers all cases
      t = r
      w = fn * PIO2_3
      r = t - w
      w = fn * PIO2_3T - (t - r - w)
      ry0 = r - w
    }
  }
  ry1 = r - ry0 - w
  return n
}

// 2/pi in 24-bit chunks (66 * 24 = 1584 bits, enough for binary64).
const IPIO2 = [
  0xa2f983, 0x6e4e44, 0x1529fc, 0x2757d1, 0xf534dd, 0xc0db62, 0x95993c, 0x439041, 0xfe5163, 0xabdebb, 0xc561b7,
  0x246e3a, 0x424dd2, 0xe00649, 0x2eea09, 0xd1921c, 0xfe1deb, 0x1cb129, 0xa73ee8, 0x8235f5, 0x2ebb44, 0x84e99c,
  0x7026b4, 0x5f7e41, 0x3991d6, 0x398353, 0x39f49c, 0x845f8b, 0xbdf928, 0x3b1ff8, 0x97ffde, 0x05980f, 0xef2f11,
  0x8b5a0a, 0x6d1f6d, 0x367ecf, 0x27cb09, 0xb74f46, 0x3f669e, 0x5fea2d, 0x7527ba, 0xc7ebe5, 0xf17b3d, 0x0739f7,
  0x8a5292, 0xea6bfb, 0x5fb11f, 0x8d5d08, 0x560330, 0x46fc7b, 0x6babf0, 0xcfbc20, 0x9af436, 0x1da9e3, 0x91615e,
  0xe61b08, 0x659985, 0x5f14a0, 0x68408d, 0xffd880, 0x4d7327, 0x310606, 0x1556ca, 0x73a8c9, 0x60e27b, 0xc08c6b,
]

// pi/2 in 24-bit chunks.
const PIO2 = [
  1.570796251296997, // 0x3FF921FB 40000000
  7.549789415861596e-8, // 0x3E74442D 00000000
  5.390302529957765e-15, // 0x3CF84698 80000000
  3.282003415807913e-22, // 0x3B78CC51 60000000
  1.270655753080676e-29, // 0x39F01B83 80000000
  1.2293330898111133e-36, // 0x387A2520 40000000
  2.7337005381646456e-44, // 0x36E38222 80000000
  2.1674168387780482e-51, // 0x3569F31D 00000000
]

// Preallocated scratch for the large reduction.
const rpTx = new Float64Array(3)
const rpIq = new Int32Array(20)
const rpF = new Float64Array(20)
const rpQ = new Float64Array(20)
const rpFq = new Float64Array(20)

/**
 * Payne-Hanek reduction (musl __rem_pio2_large) specialised to binary64
 * (prec = 1, jk = jp = 4). Input is rpTx[0..nx-1], 24-bit chunks of |x|
 * scaled by 2^-e0. Writes ry0/ry1 and returns n & 7.
 */
function remPio2Large(e0: number, nx: number): number {
  const jk = 4
  const jp = 4
  const tx = rpTx
  const iq = rpIq
  const f = rpF
  const q = rpQ
  const fq = rpFq

  // determine jx, jv, q0; note that 3 > q0
  const jx = nx - 1
  let jv = ((e0 - 3) / 24) | 0
  if (jv < 0) jv = 0
  let q0 = e0 - 24 * (jv + 1)

  // set up f[0] to f[jx+jk] where f[jx+jk] = IPIO2[jv+jk]
  let i: number
  let j = jv - jx
  let k: number
  let fw: number
  const m = jx + jk
  for (i = 0; i <= m; i++, j++) f[i] = j < 0 ? 0 : IPIO2[j]

  // compute q[0], q[1], ... q[jk]
  for (i = 0; i <= jk; i++) {
    for (j = 0, fw = 0; j <= jx; j++) fw += tx[j] * f[jx + i - j]
    q[i] = fw
  }

  let jz = jk
  let z: number
  let n: number
  let ih: number
  for (;;) {
    // distill q[] into iq[] reversingly
    for (i = 0, j = jz, z = q[jz]; j > 0; i++, j--) {
      fw = (TWO_M24 * z) | 0
      iq[i] = (z - TWO24 * fw) | 0
      z = q[j - 1] + fw
    }

    // compute n
    z = scalbn(z, q0) // actual value of z
    z -= 8 * Math.floor(z * 0.125) // trim off integer >= 8
    n = z | 0
    z -= n
    ih = 0
    if (q0 > 0) {
      // need iq[jz-1] to determine n
      i = iq[jz - 1] >> (24 - q0)
      n += i
      iq[jz - 1] -= i << (24 - q0)
      ih = iq[jz - 1] >> (23 - q0)
    } else if (q0 === 0) ih = iq[jz - 1] >> 23
    else if (z >= 0.5) ih = 2

    if (ih > 0) {
      // q > 0.5
      n += 1
      let carry = 0
      for (i = 0; i < jz; i++) {
        // compute 1-q
        j = iq[i]
        if (carry === 0) {
          if (j !== 0) {
            carry = 1
            iq[i] = 0x1000000 - j
          }
        } else iq[i] = 0xffffff - j
      }
      // rare case: chance is 1 in 12
      if (q0 === 1) iq[jz - 1] &= 0x7fffff
      else if (q0 === 2) iq[jz - 1] &= 0x3fffff
      if (ih === 2) {
        z = 1 - z
        if (carry !== 0) z -= scalbn(1, q0)
      }
    }

    // check if recomputation is needed
    if (z === 0) {
      j = 0
      for (i = jz - 1; i >= jk; i--) j |= iq[i]
      if (j === 0) {
        // need recomputation; k = no. of terms needed
        for (k = 1; iq[jk - k] === 0; k++);
        for (i = jz + 1; i <= jz + k; i++) {
          // add q[jz+1] to q[jz+k]
          f[jx + i] = IPIO2[jv + i]
          for (j = 0, fw = 0; j <= jx; j++) fw += tx[j] * f[jx + i - j]
          q[i] = fw
        }
        jz += k
        continue
      }
    }
    break
  }

  // chop off zero terms
  if (z === 0) {
    jz -= 1
    q0 -= 24
    while (iq[jz] === 0) {
      jz--
      q0 -= 24
    }
  } else {
    // break z into 24-bit if necessary
    z = scalbn(z, -q0)
    if (z >= TWO24) {
      fw = (TWO_M24 * z) | 0
      iq[jz] = (z - TWO24 * fw) | 0
      jz += 1
      q0 += 24
      iq[jz] = fw
    } else iq[jz] = z | 0
  }

  // convert integer "bit" chunk to floating-point value
  fw = scalbn(1, q0)
  for (i = jz; i >= 0; i--) {
    q[i] = fw * iq[i]
    fw *= TWO_M24
  }

  // compute PIO2[0..jp] * q[jz..0]
  for (i = jz; i >= 0; i--) {
    for (fw = 0, k = 0; k <= jp && k <= jz - i; k++) fw += PIO2[k] * q[i + k]
    fq[jz - i] = fw
  }

  // compress fq[] into y[]
  fw = 0
  for (i = jz; i >= 0; i--) fw += fq[i]
  ry0 = ih === 0 ? fw : -fw
  fw = fq[0] - fw
  for (i = 1; i <= jz; i++) fw += fq[i]
  ry1 = ih === 0 ? fw : -fw
  return n & 7
}

// ---------------------------------------------------------------------------
// sin, cos, tan

export function sin(x: number): number {
  const ix = hiWord(x) & 0x7fffffff
  if (ix <= 0x3fe921fb) {
    // |x| ~< pi/4
    if (ix < 0x3e500000) return x // |x| < 2^-26
    return kSin(x, 0, 0)
  }
  if (ix >= 0x7ff00000) return x - x // inf or NaN
  const n = remPio2(x)
  switch (n & 3) {
    case 0:
      return kSin(ry0, ry1, 1)
    case 1:
      return kCos(ry0, ry1)
    case 2:
      return -kSin(ry0, ry1, 1)
    default:
      return -kCos(ry0, ry1)
  }
}

export function cos(x: number): number {
  const ix = hiWord(x) & 0x7fffffff
  if (ix <= 0x3fe921fb) {
    // |x| ~< pi/4
    if (ix < 0x3e46a09e) return 1 // |x| < 2^-27 * sqrt(2)
    return kCos(x, 0)
  }
  if (ix >= 0x7ff00000) return x - x
  const n = remPio2(x)
  switch (n & 3) {
    case 0:
      return kCos(ry0, ry1)
    case 1:
      return -kSin(ry0, ry1, 1)
    case 2:
      return -kCos(ry0, ry1)
    default:
      return kSin(ry0, ry1, 1)
  }
}

export function tan(x: number): number {
  const ix = hiWord(x) & 0x7fffffff
  if (ix <= 0x3fe921fb) {
    // |x| ~< pi/4
    if (ix < 0x3e400000) return x // |x| < 2^-27
    return kTan(x, 0, 0)
  }
  if (ix >= 0x7ff00000) return x - x
  const n = remPio2(x)
  return kTan(ry0, ry1, n & 1)
}

// ---------------------------------------------------------------------------
// asin, acos

const PIO2_HI = 1.5707963267948966 // 0x3FF921FB 54442D18
const PIO2_LO = 6.123233995736766e-17 // 0x3C91A626 33145C07
const PS0 = 0.16666666666666666 // 0x3FC55555 55555555
const PS1 = -0.3255658186224009 // 0xBFD4D612 03EB6F7D
const PS2 = 0.20121253213486293 // 0x3FC9C155 0E884455
const PS3 = -0.04005553450067941 // 0xBFA48228 B5688F3B
const PS4 = 0.0007915349942898145 // 0x3F49EFE0 7501B288
const PS5 = 0.00003479331075960212 // 0x3F023DE1 0DFDF709
const QS1 = -2.403394911734414 // 0xC0033A27 1C8A2D4B
const QS2 = 2.0209457602335057 // 0x40002AE5 9C598AC8
const QS3 = -0.6882839716054533 // 0xBFE6066C 1B8D0159
const QS4 = 0.07703815055590194 // 0x3FB3B8C5 B12E9282

function asinR(z: number): number {
  const p = z * (PS0 + z * (PS1 + z * (PS2 + z * (PS3 + z * (PS4 + z * PS5)))))
  const q = 1 + z * (QS1 + z * (QS2 + z * (QS3 + z * QS4)))
  return p / q
}

export function asin(x: number): number {
  wf[0] = x
  const hx = wu[HI]
  const ix = hx & 0x7fffffff
  if (ix >= 0x3ff00000) {
    // |x| >= 1 or NaN
    if (((ix - 0x3ff00000) | wu[LO]) === 0) return x * PIO2_HI + TWO_M120 // asin(+-1) = +-pi/2
    return NaN // |x| > 1 or NaN
  }
  if (ix < 0x3fe00000) {
    // |x| < 0.5; for 2^-1022 <= |x| < 2^-26 avoid raising underflow
    if (ix < 0x3e500000 && ix >= 0x00100000) return x
    return x + x * asinR(x * x)
  }
  // 1 > |x| >= 0.5
  const z = (1 - Math.abs(x)) * 0.5
  const s = Math.sqrt(z)
  const r = asinR(z)
  if (ix >= 0x3fef3333) {
    // |x| > 0.975
    x = PIO2_HI - (2 * (s + s * r) - PIO2_LO)
  } else {
    // f+c = sqrt(z)
    const f = withLo(s, 0)
    const c = (z - f * f) / (s + f)
    x = 0.5 * PIO2_HI - (2 * s * r - (PIO2_LO - 2 * c) - (0.5 * PIO2_HI - 2 * f))
  }
  return hx >>> 31 ? -x : x
}

export function acos(x: number): number {
  wf[0] = x
  const hx = wu[HI]
  const ix = hx & 0x7fffffff
  if (ix >= 0x3ff00000) {
    // |x| >= 1 or NaN
    if (((ix - 0x3ff00000) | wu[LO]) === 0) {
      // acos(1) = 0, acos(-1) = pi
      if (hx >>> 31) return 2 * PIO2_HI + TWO_M120
      return 0
    }
    return NaN // |x| > 1 or NaN
  }
  if (ix < 0x3fe00000) {
    // |x| < 0.5
    if (ix <= 0x3c600000) return PIO2_HI + TWO_M120 // |x| < 2^-57
    return PIO2_HI - (x - (PIO2_LO - x * asinR(x * x)))
  }
  let z: number
  let s: number
  if (hx >>> 31) {
    // x < -0.5
    z = (1 + x) * 0.5
    s = Math.sqrt(z)
    const w = asinR(z) * s - PIO2_LO
    return 2 * (PIO2_HI - (s + w))
  }
  // x > 0.5
  z = (1 - x) * 0.5
  s = Math.sqrt(z)
  const df = withLo(s, 0)
  const c = (z - df * df) / (s + df)
  const w = asinR(z) * s + c
  return 2 * (df + w)
}

// ---------------------------------------------------------------------------
// atan, atan2

const ATANHI0 = 0.4636476090008061 // atan(0.5) hi, 0x3FDDAC67 0561BB4F
const ATANHI1 = 0.7853981633974483 // atan(1.0) hi, 0x3FE921FB 54442D18
const ATANHI2 = 0.982793723247329 // atan(1.5) hi, 0x3FEF730B D281F69B
const ATANHI3 = 1.5707963267948966 // atan(inf) hi, 0x3FF921FB 54442D18
const ATANLO0 = 2.2698777452961687e-17 // 0x3C7A2B7F 222F65E2
const ATANLO1 = 3.061616997868383e-17 // 0x3C81A626 33145C07
const ATANLO2 = 1.3903311031230998e-17 // 0x3C700788 7AF0CBBD
const ATANLO3 = 6.123233995736766e-17 // 0x3C91A626 33145C07
const AT0 = 0.3333333333333293 // 0x3FD55555 5555550D
const AT1 = -0.19999999999876483 // 0xBFC99999 9998EBC4
const AT2 = 0.14285714272503466 // 0x3FC24924 920083FF
const AT3 = -0.11111110405462356 // 0xBFBC71C6 FE231671
const AT4 = 0.09090887133436507 // 0x3FB745CD C54C206E
const AT5 = -0.0769187620504483 // 0xBFB3B0F2 AF749A6D
const AT6 = 0.06661073137387531 // 0x3FB10D66 A0D03D51
const AT7 = -0.058335701337905735 // 0xBFADDE2D 52DEFD9A
const AT8 = 0.049768779946159324 // 0x3FA97B4B 24760DEB
const AT9 = -0.036531572744216916 // 0xBFA2B444 2C6A6C2F
const AT10 = 0.016285820115365782 // 0x3F90AD3A E322DA11

export function atan(x: number): number {
  const hx = hiWord(x)
  const sign = hx >>> 31
  const ix = hx & 0x7fffffff
  let id: number
  if (ix >= 0x44100000) {
    // |x| >= 2^66
    if (x !== x) return x
    const z = ATANHI3 + TWO_M120
    return sign ? -z : z
  }
  if (ix < 0x3fdc0000) {
    // |x| < 0.4375
    if (ix < 0x3e400000) return x // |x| < 2^-27
    id = -1
  } else {
    x = Math.abs(x)
    if (ix < 0x3ff30000) {
      // |x| < 1.1875
      if (ix < 0x3fe60000) {
        // 7/16 <= |x| < 11/16
        id = 0
        x = (2 * x - 1) / (2 + x)
      } else {
        // 11/16 <= |x| < 19/16
        id = 1
        x = (x - 1) / (x + 1)
      }
    } else if (ix < 0x40038000) {
      // |x| < 2.4375
      id = 2
      x = (x - 1.5) / (1 + 1.5 * x)
    } else {
      // 2.4375 <= |x| < 2^66
      id = 3
      x = -1 / x
    }
  }
  const z = x * x
  const w = z * z
  // break sum AT[i] z^(i+1) into odd and even poly
  const s1 = z * (AT0 + w * (AT2 + w * (AT4 + w * (AT6 + w * (AT8 + w * AT10)))))
  const s2 = w * (AT1 + w * (AT3 + w * (AT5 + w * (AT7 + w * AT9))))
  if (id < 0) return x - x * (s1 + s2)
  let r: number
  switch (id) {
    case 0:
      r = ATANHI0 - (x * (s1 + s2) - ATANLO0 - x)
      break
    case 1:
      r = ATANHI1 - (x * (s1 + s2) - ATANLO1 - x)
      break
    case 2:
      r = ATANHI2 - (x * (s1 + s2) - ATANLO2 - x)
      break
    default:
      r = ATANHI3 - (x * (s1 + s2) - ATANLO3 - x)
  }
  return sign ? -r : r
}

const PI = 3.141592653589793 // 0x400921FB 54442D18
const PI_LO = 1.2246467991473532e-16 // 0x3CA1A626 33145C07

export function atan2(y: number, x: number): number {
  if (x !== x || y !== y) return x + y
  wf[0] = x
  let ix = wu[HI]
  const lx = wu[LO]
  wf[0] = y
  let iy = wu[HI]
  const ly = wu[LO]
  if (((ix - 0x3ff00000) | lx) === 0) return atan(y) // x = 1.0
  const m = ((iy >>> 31) & 1) | ((ix >>> 30) & 2) // 2*sign(x) + sign(y)
  ix &= 0x7fffffff
  iy &= 0x7fffffff

  // y = 0
  if ((iy | ly) === 0) {
    switch (m) {
      case 0:
      case 1:
        return y // atan(+-0, +anything) = +-0
      case 2:
        return PI // atan(+0, -anything) = pi
      default:
        return -PI // atan(-0, -anything) = -pi
    }
  }
  // x = 0
  if ((ix | lx) === 0) return m & 1 ? -PI / 2 : PI / 2
  // x = inf
  if (ix === 0x7ff00000) {
    if (iy === 0x7ff00000) {
      switch (m) {
        case 0:
          return PI / 4 // atan(+inf, +inf)
        case 1:
          return -PI / 4 // atan(-inf, +inf)
        case 2:
          return (3 * PI) / 4 // atan(+inf, -inf)
        default:
          return (-3 * PI) / 4 // atan(-inf, -inf)
      }
    }
    switch (m) {
      case 0:
        return 0 // atan(+..., +inf)
      case 1:
        return -0 // atan(-..., +inf)
      case 2:
        return PI // atan(+..., -inf)
      default:
        return -PI // atan(-..., -inf)
    }
  }
  // |y/x| > 2^64
  if (ix + (64 << 20) < iy || iy === 0x7ff00000) return m & 1 ? -PI / 2 : PI / 2

  // z = atan(|y/x|) without spurious underflow
  const z = m & 2 && iy + (64 << 20) < ix ? 0 : atan(Math.abs(y / x)) // |y/x| < 2^-64, x < 0
  switch (m) {
    case 0:
      return z // atan(+, +)
    case 1:
      return -z // atan(-, +)
    case 2:
      return PI - (z - PI_LO) // atan(+, -)
    default:
      return z - PI_LO - PI // atan(-, -)
  }
}

// ---------------------------------------------------------------------------
// exp, log (fdlibm)

const LN2_HI = 0.6931471803691238 // 0x3FE62E42 FEE00000
const LN2_LO = 1.9082149292705877e-10 // 0x3DEA39EF 35793C76
const INVLN2 = 1.4426950408889634 // 0x3FF71547 652B82FE
const P1 = 0.16666666666666602 // 0x3FC55555 5555553E
const P2 = -0.0027777777777015593 // 0xBF66C16C 16BEBD93
const P3 = 0.00006613756321437934 // 0x3F11566A AF25DE2C
const P4 = -0.0000016533902205465252 // 0xBEBBBD41 C5D26BF1
const P5 = 4.1381367970572385e-8 // 0x3E663769 72BEA4D0
const EXP_OVF = 709.782712893384 // 0x40862E42 FEFA39EF
const EXP_UFL = -708.3964185322641 // 0xC086232B DD7ABCD2
const EXP_ZERO = -745.1332191019411 // 0xC0874910 D52D3051

export function exp(x: number): number {
  const hx0 = hiWord(x)
  const sign = hx0 >>> 31
  const hx = hx0 & 0x7fffffff // high word of |x|

  // special cases
  if (hx >= 0x4086232b) {
    // |x| >= 708.39...
    if (x !== x) return x
    if (x > EXP_OVF) return x * TWO1023 // overflow if x != inf
    if (x < EXP_UFL && x < EXP_ZERO) return 0
  }

  // argument reduction
  let k: number
  let hi: number
  let lo: number
  if (hx > 0x3fd62e42) {
    // |x| > 0.5 ln2
    if (hx >= 0x3ff0a2b2) k = (INVLN2 * x + (sign ? -0.5 : 0.5)) | 0 // |x| >= 1.5 ln2
    else k = 1 - sign - sign
    hi = x - k * LN2_HI // k*LN2_HI is exact here
    lo = k * LN2_LO
    x = hi - lo
  } else if (hx > 0x3e300000) {
    // |x| > 2^-28
    k = 0
    hi = x
    lo = 0
  } else {
    return 1 + x
  }

  // x is now in primary range
  const xx = x * x
  const c = x - xx * (P1 + xx * (P2 + xx * (P3 + xx * (P4 + xx * P5))))
  const y = 1 + ((x * c) / (2 - c) - lo + hi)
  if (k === 0) return y
  return scalbn(y, k)
}

const LG1 = 0.6666666666666735 // 0x3FE55555 55555593
const LG2 = 0.3999999999940942 // 0x3FD99999 9997FA04
const LG3 = 0.2857142874366239 // 0x3FD24924 94229359
const LG4 = 0.22222198432149784 // 0x3FCC71C5 1D8E78AF
const LG5 = 0.1818357216161805 // 0x3FC74664 96CB03DE
const LG6 = 0.15313837699209373 // 0x3FC39A09 D078C69F
const LG7 = 0.14798198605116586 // 0x3FC2F112 DF3E5244

export function log(x: number): number {
  wf[0] = x
  let hx = wu[HI]
  let k = 0
  if (hx < 0x00100000 || hx >>> 31) {
    if (((hx << 1) | wu[LO]) === 0) return -1 / (x * x) // log(+-0) = -inf
    if (hx >>> 31) return (x - x) / 0 // log(-#) = NaN
    // subnormal, scale x up
    k -= 54
    x *= TWO54
    hx = hiWord(x)
  } else if (hx >= 0x7ff00000) {
    return x
  } else if (hx === 0x3ff00000 && wu[LO] === 0) {
    return 0
  }

  // reduce x into [sqrt(2)/2, sqrt(2)]
  hx += 0x3ff00000 - 0x3fe6a09e
  k += (hx >>> 20) - 0x3ff
  hx = (hx & 0x000fffff) + 0x3fe6a09e
  x = withHi(x, hx)

  const f = x - 1
  const hfsq = 0.5 * f * f
  const s = f / (2 + f)
  const z = s * s
  const w = z * z
  const t1 = w * (LG2 + w * (LG4 + w * LG6))
  const t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)))
  const r = t2 + t1
  const dk = k
  return s * (hfsq + r) + dk * LN2_LO - hfsq + f + dk * LN2_HI
}

// ---------------------------------------------------------------------------
// pow (fdlibm)

const DP_H1 = 0.5849624872207642 // 0x3FE2B803 40000000
const DP_L1 = 1.350039202129749e-8 // 0x3E4CFDEB 43CFD006
const HUGE = 1e300
const TINY = 1e-300
const L1 = 0.5999999999999946 // 0x3FE33333 33333303
const L2 = 0.4285714285785502 // 0x3FDB6DB6 DB6FABFF
const L3 = 0.33333332981837743 // 0x3FD55555 518F264D
const L4 = 0.272728123808534 // 0x3FD17460 A91D4101
const L5 = 0.23066074577556175 // 0x3FCD864A 93C9DB65
const L6 = 0.20697501780033842 // 0x3FCA7E28 4A454EEF
const LG2_ = 0.6931471805599453 // 0x3FE62E42 FEFA39EF
const LG2_H = 0.6931471824645996 // 0x3FE62E43 00000000
const LG2_L = -1.904654299957768e-9 // 0xBE205C61 0CA86C39
const OVT = 8.008566259537294e-17 // -(1024 - log2(ovfl + .5ulp))
const CP = 0.9617966939259756 // 0x3FEEC709 DC3A03FD, 2/(3 ln2)
const CP_H = 0.9617967009544373 // 0x3FEEC709 E0000000, (float)CP
const CP_L = -7.028461650952758e-9 // 0xBE3E2FE0 145B01F5, tail of CP_H
const IVLN2 = 1.4426950408889634 // 0x3FF71547 652B82FE, 1/ln2
const IVLN2_H = 1.4426950216293335 // 0x3FF71547 60000000, 24-bit 1/ln2
const IVLN2_L = 1.9259629911266175e-8 // 0x3E54AE0B F85DDF44, 1/ln2 tail

export function pow(x: number, y: number): number {
  wf[0] = x
  const hx = wu[HI] | 0
  const lx = wu[LO]
  wf[0] = y
  const hy = wu[HI] | 0
  const ly = wu[LO]
  let ix = hx & 0x7fffffff
  const iy = hy & 0x7fffffff

  // JS (unlike C99) returns NaN for x^NaN and (+-1)^(+-inf), including 1^NaN.
  if (y !== y) return NaN
  // x^0 = 1, even if x is NaN
  if ((iy | ly) === 0) return 1
  if (iy === 0x7ff00000 && ly === 0 && ix === 0x3ff00000 && lx === 0) return NaN
  // 1^y = 1
  if (hx === 0x3ff00000 && lx === 0) return 1
  // NaN if x is NaN
  if (ix > 0x7ff00000 || (ix === 0x7ff00000 && lx !== 0)) return x + y

  // yisint: 0 = not an integer, 1 = odd integer, 2 = even integer (only when x < 0)
  let yisint = 0
  let k: number
  let j: number
  if (hx < 0) {
    if (iy >= 0x43400000) yisint = 2 // even integer y
    else if (iy >= 0x3ff00000) {
      k = (iy >> 20) - 0x3ff // exponent
      if (k > 20) {
        j = ly >>> (52 - k)
        if ((j << (52 - k)) >>> 0 === ly) yisint = 2 - (j & 1)
      } else if (ly === 0) {
        j = iy >> (20 - k)
        if (j << (20 - k) === iy) yisint = 2 - (j & 1)
      }
    }
  }

  // special values of y
  if (ly === 0) {
    if (iy === 0x7ff00000) {
      // y is +-inf ((+-1)^+-inf handled above)
      if (ix >= 0x3ff00000) return hy >= 0 ? y : 0 // (|x|>1)^+-inf = inf, 0
      return hy >= 0 ? 0 : -y // (|x|<1)^+-inf = 0, inf
    }
    if (iy === 0x3ff00000) return hy >= 0 ? x : 1 / x // y is +-1
    if (hy === 0x40000000) return x * x // y is 2
    if (hy === 0x3fe00000 && hx >= 0) return Math.sqrt(x) // y is 0.5, x >= +0
  }

  let ax = Math.abs(x)
  let z: number
  // special values of x
  if (lx === 0 && (ix === 0x7ff00000 || ix === 0 || ix === 0x3ff00000)) {
    // x is +-0, +-inf, +-1
    z = ax
    if (hy < 0) z = 1 / z // z = 1/|x|
    if (hx < 0) {
      if (((ix - 0x3ff00000) | yisint) === 0) z = (z - z) / (z - z) // (-1)^non-int is NaN
      else if (yisint === 1) z = -z // (x<0)^odd = -(|x|^odd)
    }
    return z
  }

  let s = 1 // sign of result
  if (hx < 0) {
    if (yisint === 0) return (x - x) / (x - x) // (x<0)^(non-int) is NaN
    if (yisint === 1) s = -1 // (x<0)^(odd int)
  }

  let t: number
  let t1: number
  let t2: number
  let u: number
  let v: number
  let w: number
  if (iy > 0x41e00000) {
    // |y| > 2^31
    if (iy > 0x43f00000) {
      // |y| > 2^64, must over/underflow
      if (ix <= 0x3fefffff) return hy < 0 ? HUGE * HUGE : TINY * TINY
      if (ix >= 0x3ff00000) return hy > 0 ? HUGE * HUGE : TINY * TINY
    }
    // over/underflow if x is not close to one
    if (ix < 0x3fefffff) return hy < 0 ? s * HUGE * HUGE : s * TINY * TINY
    if (ix > 0x3ff00000) return hy > 0 ? s * HUGE * HUGE : s * TINY * TINY
    // |1-x| <= 2^-20: log(x) ~ x - x^2/2 + x^3/3 - x^4/4
    t = ax - 1 // t has 20 trailing zeros
    w = t * t * (0.5 - t * (0.3333333333333333 - t * 0.25))
    u = IVLN2_H * t // IVLN2_H has 21 sig. bits
    v = t * IVLN2_L - w * IVLN2
    t1 = withLo(u + v, 0)
    t2 = v - (t1 - u)
  } else {
    let n = 0
    // take care of subnormal x
    if (ix < 0x00100000) {
      ax *= TWO53
      n -= 53
      ix = hiWord(ax) | 0
    }
    n += (ix >> 20) - 0x3ff
    j = ix & 0x000fffff
    // determine interval
    ix = j | 0x3ff00000 // normalize ix
    if (j <= 0x3988e) k = 0 // |x| < sqrt(3/2)
    else if (j < 0xbb67a) k = 1 // |x| < sqrt(3)
    else {
      k = 0
      n += 1
      ix -= 0x00100000
    }
    ax = withHi(ax, ix)

    // ss = s_h + s_l = (x-1)/(x+1) or (x-1.5)/(x+1.5)
    const bp = k === 0 ? 1 : 1.5
    u = ax - bp
    v = 1 / (ax + bp)
    const ss = u * v
    const sh = withLo(ss, 0)
    // t_h = ax + bp High
    let th = fromWords(((ix >> 1) | 0x20000000) + 0x00080000 + (k << 18), 0)
    let tl = ax - (th - bp)
    const sl = v * (u - sh * th - sh * tl)
    // compute log(ax)
    let s2 = ss * ss
    let r = s2 * s2 * (L1 + s2 * (L2 + s2 * (L3 + s2 * (L4 + s2 * (L5 + s2 * L6)))))
    r += sl * (sh + ss)
    s2 = sh * sh
    th = withLo(3 + s2 + r, 0)
    tl = r - (th - 3 - s2)
    // u + v = ss * (1 + ...)
    u = sh * th
    v = sl * th + tl * ss
    // 2/(3 log2) * (ss + ...)
    const ph = withLo(u + v, 0)
    const pl = v - (ph - u)
    const zh = CP_H * ph // CP_H + CP_L = 2/(3 log2)
    const dph = k === 0 ? 0 : DP_H1
    const zl = CP_L * ph + pl * CP + (k === 0 ? 0 : DP_L1)
    // log2(ax) = (ss + ...) * 2/(3 log2) = n + dp_h + z_h + z_l
    t = n
    t1 = withLo(zh + zl + dph + t, 0)
    t2 = zl - (t1 - t - dph - zh)
  }

  // split y into y1 + y2 and compute (y1 + y2) * (t1 + t2)
  const y1 = withLo(y, 0)
  const pl = (y - y1) * t1 + y * t2
  let ph = y1 * t1
  z = pl + ph
  wf[0] = z
  j = wu[HI] | 0
  let i = wu[LO]
  if (j >= 0x40900000) {
    // z >= 1024
    if (((j - 0x40900000) | i) !== 0) return s * HUGE * HUGE // z > 1024
    if (pl + OVT > z - ph) return s * HUGE * HUGE
  } else if ((j & 0x7fffffff) >= 0x4090cc00) {
    // z <= -1075
    if (((j - 0xc090cc00) | i) !== 0) return s * TINY * TINY // z < -1075
    if (pl <= z - ph) return s * TINY * TINY
  }

  // compute 2^(ph + pl)
  i = j & 0x7fffffff
  k = (i >> 20) - 0x3ff
  let n = 0
  if (i > 0x3fe00000) {
    // |z| > 0.5, set n = [z + 0.5]
    n = (j + (0x00100000 >> (k + 1))) | 0
    k = ((n & 0x7fffffff) >> 20) - 0x3ff // new k for n
    t = fromWords(n & ~(0x000fffff >> k), 0)
    n = ((n & 0x000fffff) | 0x00100000) >> (20 - k)
    if (j < 0) n = -n
    ph -= t
  }
  t = withLo(pl + ph, 0)
  u = t * LG2_H
  v = (pl - (t - ph)) * LG2_ + t * LG2_L
  z = u + v
  w = v - (z - u)
  t = z * z
  t1 = z - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))))
  const r = (z * t1) / (t1 - 2) - (w + z * w)
  z = 1 - (r - z)
  j = (hiWord(z) | 0) + (n << 20)
  if (j >> 20 <= 0) z = scalbn(z, n) // subnormal output
  else z = withHi(z, j)
  return s * z
}

// ---------------------------------------------------------------------------
// hypot

const SPLIT = 134217729 // 0x1p27 + 1

/**
 * hypot(x, y) is musl's. hypot(x, y, z) (no musl counterpart) uses the same
 * exact squares plus a compensated sum and one Newton correction, so it stays
 * within about half an ulp.
 */
export function hypot(x: number, y: number, z?: number): number {
  if (z !== undefined) return hypot3(x, y, z)
  let a = Math.abs(x)
  let b = Math.abs(y)
  // arrange a >= b
  if (a < b) {
    const t = a
    a = b
    b = t
  }
  // mask: Math.abs may leave the sign bit of a NaN set
  wf[0] = a
  const ea = (wu[HI] >>> 20) & 0x7ff
  wf[0] = b
  const eb = (wu[HI] >>> 20) & 0x7ff
  // inf beats NaN: hypot(inf, NaN) = inf
  if (ea === 0x7ff || eb === 0x7ff) return a === Infinity || b === Infinity ? Infinity : NaN
  if (b === 0) return a
  // hypot(a, b) ~= a + b*b/a/2 with inexact for small b/a
  if (ea - eb > 64) return a + b

  // precise sqrt argument without overflow: a*a must not overflow and
  // the low split parts squared must not underflow
  let scale = 1
  if (ea > 0x3ff + 510) {
    scale = TWO700
    a *= TWO_M700
    b *= TWO_M700
  } else if (eb < 0x3ff - 450) {
    scale = TWO_M700
    a *= TWO700
    b *= TWO700
  }
  let c = a * SPLIT
  let h = a - c + c
  let l = a - h
  const ha = a * a
  const la = h * h - ha + 2 * h * l + l * l
  c = b * SPLIT
  h = b - c + c
  l = b - h
  const hb = b * b
  const lb = h * h - hb + 2 * h * l + l * l
  return scale * Math.sqrt(lb + la + hb + ha)
}

function hypot3(x: number, y: number, z: number): number {
  let a = Math.abs(x)
  let b = Math.abs(y)
  let c = Math.abs(z)
  if (a === Infinity || b === Infinity || c === Infinity) return Infinity
  if (a !== a || b !== b || c !== c) return NaN
  // sort so a >= b >= c
  let t: number
  if (a < b) {
    t = a
    a = b
    b = t
  }
  if (b < c) {
    t = b
    b = c
    c = t
  }
  if (a < b) {
    t = a
    a = b
    b = t
  }
  if (c === 0) return hypot(a, b)
  wf[0] = a
  const ea = wu[HI] >>> 20
  wf[0] = c
  const ec = wu[HI] >>> 20
  // c is negligible next to a (relative contribution < 2^-128)
  if (ea - ec > 64) return hypot(a, b)

  // all three are within 2^65 of each other, so one scale fits them all
  let scale = 1
  if (ea > 0x3ff + 510) {
    scale = TWO700
    a *= TWO_M700
    b *= TWO_M700
    c *= TWO_M700
  } else if (ec < 0x3ff - 450) {
    scale = TWO_M700
    a *= TWO700
    b *= TWO700
    c *= TWO700
  }
  let s = a * SPLIT
  let h = a - s + s
  let l = a - h
  const ha = a * a
  const la = h * h - ha + 2 * h * l + l * l
  s = b * SPLIT
  h = b - s + s
  l = b - h
  const hb = b * b
  const lb = h * h - hb + 2 * h * l + l * l
  s = c * SPLIT
  h = c - s + s
  l = c - h
  const hc = c * c
  const lc = h * h - hc + 2 * h * l + l * l
  // sum of squares as sh + sl, with the rounding errors of the high parts
  // recovered exactly (TwoSum)
  let sh = ha + hb
  let bv = sh - ha
  let sl = ha - (sh - bv) + (hb - bv)
  t = sh + hc
  bv = t - sh
  sl += sh - (t - bv) + (hc - bv) + la + lb + lc
  sh = t + sl
  sl -= sh - t
  // one Newton step on the exact residual: r += (sh + sl - r*r) / (2r)
  let r = Math.sqrt(sh)
  s = r * SPLIT
  h = r - s + s
  l = r - h
  const rr = r * r
  const rl = h * h - rr + 2 * h * l + l * l
  r += (sh - rr - rl + sl) / (2 * r)
  return scale * r
}
