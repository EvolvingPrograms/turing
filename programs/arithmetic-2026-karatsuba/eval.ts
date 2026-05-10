import { fromPositional } from "../encoding"

/**
 * Karatsuba multiplication.
 *
 * For N-digit operands a, b (decimal), pick half = ceil(N/2):
 *   a = a_hi * 10^half + a_lo
 *   b = b_hi * 10^half + b_lo
 *
 * Schoolbook would require 4 sub-multiplications:
 *   a*b = a_hi*b_hi * 10^(2*half) + (a_hi*b_lo + a_lo*b_hi) * 10^half + a_lo*b_lo
 *
 * Karatsuba uses 3 instead via the identity:
 *   z0 = a_lo * b_lo
 *   z2 = a_hi * b_hi
 *   z3 = (a_hi + a_lo) * (b_hi + b_lo)
 *   z1 = z3 - z2 - z0   (= a_hi*b_lo + a_lo*b_hi, no extra multiplication)
 *   result = z2 * 10^(2*half) + z1 * 10^half + z0
 *
 * Recursion: O(N^log2(3)) ≈ O(N^1.585) vs schoolbook O(N²).
 *
 * Trace format: each call emits a K<depth> header, the SPLIT, three CALL/RET
 * pairs for the sub-multiplications, the subtraction, two SHIFTs, and a
 * partial+result combine. Base case (both operands < 10) emits a single
 * `BASE prod=a*b=N` line. The recursive structure means the trace is
 * naturally nested; the K<depth> label disambiguates which frame we're in.
 */

function digitsOf(n: bigint): number {
  if (n === 0n) return 1
  let count = 0
  let x = n
  while (x > 0n) {
    count++
    x = x / 10n
  }
  return count
}

// Base case threshold: both operands ≤ 2 decimal digits. The model does the
// 2x2 multiplication mentally on a single line (max 99*99=9801). This cuts
// two levels of recursion vs single-digit base.
const BASE_THRESHOLD = 100n

function karatsuba(
  a: bigint,
  b: bigint,
  depth: number,
  log: (...args: string[]) => void
): bigint {
  if (a < BASE_THRESHOLD && b < BASE_THRESHOLD) {
    const product = a * b
    log(`K${depth} BASE prod=${a}*${b}=${product}`)
    return product
  }

  const N = Math.max(digitsOf(a), digitsOf(b))
  const half = Math.ceil(N / 2)
  const split = 10n ** BigInt(half)

  const aHi = a / split
  const aLo = a % split
  const bHi = b / split
  const bLo = b % split

  // Zero-pad HI and LO to exactly `half` digits — uniform cell width per
  // split removes a class of formatting variance the model was inclined to
  // produce on its own (writing "06" instead of "6" when half=2).
  const pad = (n: bigint) => n.toString().padStart(half, "0")
  const aHiP = pad(aHi)
  const aLoP = pad(aLo)
  const bHiP = pad(bHi)
  const bLoP = pad(bLo)

  log(`K${depth} A=${a} B=${b} HALF=${half}`)
  log(`A_HI=${aHiP} A_LO=${aLoP} B_HI=${bHiP} B_LO=${bLoP}`)

  // Inline base-case sub-calls onto one line; only wrap recursive sub-calls
  // with CALL/RET to mark scope.
  const subCall = (
    name: string,
    expr: string,
    x: bigint,
    y: bigint,
    xRepr: string,
    yRepr: string,
  ): bigint => {
    if (x < BASE_THRESHOLD && y < BASE_THRESHOLD) {
      const r = x * y
      // Explicit BASE prefix makes base-case lines syntactically distinct
      // from CALL lines — the model can't conflate "do it inline" with
      // "skip the recursion."
      log(`BASE ${name} = ${expr} = ${xRepr}*${yRepr} = ${r}`)
      return r
    }
    log(`CALL ${name} = ${expr} = ${xRepr}*${yRepr}`)
    const r = karatsuba(x, y, depth + 1, log)
    log(`RET ${name} = ${r}`)
    return r
  }

  const z0 = subCall("z0", "A_LO*B_LO", aLo, bLo, aLoP, bLoP)
  const z2 = subCall("z2", "A_HI*B_HI", aHi, bHi, aHiP, bHiP)

  // Sums use natural width (they may overflow `half` digits by one — that's
  // the structural complication that makes Karatsuba recursion asymmetric).
  const sx = aHi + aLo
  const sy = bHi + bLo
  log(`sx = ${aHiP}+${aLoP} = ${sx}`)
  log(`sy = ${bHiP}+${bLoP} = ${sy}`)

  const z3 = subCall("z3", "sx*sy", sx, sy, sx.toString(), sy.toString())

  const z1 = z3 - z2 - z0
  log(`z1=${z3}-${z2}-${z0}=${z1}`)

  // Decompose the combine into atomic ops so each line is a single 2-operand
  // arithmetic step. Multi-precision additions on long numbers are a known
  // failure mode if packed too densely.
  const shiftHi = z2 * (10n ** BigInt(2 * half))
  const shiftMid = z1 * (10n ** BigInt(half))
  log(`shiftHi=${z2}*10^${2 * half}=${shiftHi}`)
  log(`shiftMid=${z1}*10^${half}=${shiftMid}`)

  const partial = shiftHi + shiftMid
  log(`partial=${shiftHi}+${shiftMid}=${partial}`)

  const result = partial + z0
  log(`result=${partial}+${z0}=${result}`)
  log(`K${depth} RETURN ${result}`)

  return result
}

export default function multiply(
  numA: number | string,
  numB: number | string
): string {
  const a = typeof numA === "string"
    ? (numA.includes(":") ? BigInt(fromPositional(numA).split("").reverse().join("")) : BigInt(numA))
    : BigInt(numA)
  const b = typeof numB === "string"
    ? (numB.includes(":") ? BigInt(fromPositional(numB).split("").reverse().join("")) : BigInt(numB))
    : BigInt(numB)

  let output = ""
  const log = (...args: string[]) => {
    output += args.join("\n") + "\n"
  }

  log("START")
  log(`A=${a} B=${b}`)
  const result = karatsuba(a, b, 0, log)
  log(`RETURN ${result}`)

  // BigInt cross-check.
  const expected = a * b
  if (result !== expected) {
    throw new Error(
      `eval.ts produced wrong product: ${a}*${b} expected=${expected} got=${result}`
    )
  }

  return output.trim()
}
