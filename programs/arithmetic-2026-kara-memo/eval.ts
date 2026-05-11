import { fromPositional } from "../encoding"

/**
 * Hybrid Karatsuba + Cross-Memo.
 *
 * Top-level Karatsuba split (3-of-4 multiplication identity):
 *   a*b = z2 * 10^(2*half) + z1 * 10^half + z0
 *   where z0 = a_lo * b_lo, z2 = a_hi * b_hi, z3 = (a_hi+a_lo)*(b_hi+b_lo),
 *   z1 = z3 - z2 - z0
 *
 * Each sub-multiplication (z0, z2, z3) is itself solved via cross-memo
 * with chunk=2 (base-100, 2x2 mental products). The Karatsuba layer fires
 * only when operand digit count exceeds karatsubaThreshold; otherwise
 * the multiplication is pure cross-memo.
 *
 * The two phases compose cleanly because cross-memo is self-contained
 * (its own START / CHUNK / REFRESH / END structure). The Karatsuba layer
 * wraps three CALL ... RET blocks plus a combine.
 *
 * Pricing intuition: at large N, Karatsuba's 3-of-4 reduction dominates
 * cross-memo's per-token efficiency. At small N, Karatsuba's per-frame
 * framing overhead exceeds savings — so we short-circuit to direct
 * cross-memo below the threshold.
 */

type CellTape = number[]
const TAPE_CHUNK = 8

function digitsOfBig(n: bigint): number {
  if (n === 0n) return 1
  let count = 0
  let x = n
  while (x > 0n) { count++; x = x / 10n }
  return count
}

export function makeMultiply(chunk: number, karatsubaThreshold: number) {
  if (!Number.isInteger(chunk) || chunk < 1 || chunk > 6) {
    throw new Error(`chunk must be 1..6, got ${chunk}`)
  }
  if (!Number.isInteger(karatsubaThreshold) || karatsubaThreshold < 4) {
    throw new Error(`karatsubaThreshold must be >= 4`)
  }
  const BASE = 10n ** BigInt(chunk)
  const CELL_MAX = Number(BASE)

  // ----- Cross-memo (same logic as arithmetic-2026-cross-memo) -----

  function digitsToTape(digits: string): CellTape {
    const pad = digits.length % chunk === 0 ? 0 : chunk - (digits.length % chunk)
    const padded = "0".repeat(pad) + digits
    const tape: CellTape = []
    for (let i = padded.length; i > 0; i -= chunk) {
      tape.push(parseInt(padded.slice(i - chunk, i), 10))
    }
    return tape
  }
  const padCell = (n: number) => n.toString().padStart(chunk, "0")
  function tapeFmt(tape: CellTape, prefix: string): string {
    const cells = tape.map((v, i) => `${prefix}${i}_${padCell(v)}`)
    const lines: string[] = []
    for (let i = 0; i < cells.length; i += TAPE_CHUNK) {
      lines.push(cells.slice(i, i + TAPE_CHUNK).join(" "))
    }
    return lines.join("\n")
  }
  function tapeToBigInt(tape: CellTape): bigint {
    let acc = 0n
    for (let i = tape.length - 1; i >= 0; i--) acc = acc * BASE + BigInt(tape[i])
    return acc
  }

  function crossMemoMultiply(
    a: bigint,
    b: bigint,
    log: (...args: string[]) => void,
    topLevel: boolean
  ): bigint {
    const A = digitsToTape(a.toString(10))
    const B = digitsToTape(b.toString(10))
    const N = A.length
    const M = B.length
    const out: CellTape = []
    let carry = 0
    const REFRESH_INTERVAL = 8

    // topLevel=true: emit a self-terminating cross-memo trace ending in
    //   `RETURN O0_.. O1_.. ...` — same shape as the standalone cross-memo
    //   program. Stays in cell-space so the model never reverses+concats
    //   16+ cells into a single integer.
    // topLevel=false: wrap inside SUB / END_SUB so the karatsuba caller
    //   can frame this as a sub-multiplication and read SUB_RETURN cells.
    if (!topLevel) log("SUB")
    log(`CHUNK=${chunk}`)

    for (let k = 0; k < N + M - 1; k++) {
      const tick = k % REFRESH_INTERVAL
      if (tick === 0) {
        log(`tick=${tick} [FIRE]`)
        log("REFRESH")
        log(tapeFmt(A, "A"))
        log(tapeFmt(B, "B"))
        log("END_REFRESH")
      } else {
        log(`tick=${tick} [SKIP]`)
      }
      log(`k=${k}`)

      const pairs: Array<[number, number]> = []
      for (let i = Math.max(0, k - (M - 1)); i <= Math.min(N - 1, k); i++) {
        pairs.push([i, k - i])
      }

      let sum = 0
      if (pairs.length === 0) {
        log("sum=0")
      } else {
        let p = 0
        const emitProduct = (idx: number) => {
          const [i, j] = pairs[idx]
          return { i, j, av: A[i], bv: B[j], prod: A[i] * B[j] }
        }
        // [i/n] at line START — front-loaded row position. See
        // cross-memo/eval.ts for rationale. Left-to-right principle: the
        // model commits to its row position before computing the rest of
        // the line, so the position label constrains the line's contents
        // and the next-line branch (more pairs vs close row).
        const n = pairs.length
        while (p < pairs.length) {
          if (p + 1 < pairs.length) {
            const a = emitProduct(p), b = emitProduct(p + 1)
            const pairSum = a.prod + b.prod
            const consumed = p + 2
            const lhs = `[${consumed}/${n}] A${a.i}_${padCell(a.av)}*B${a.j}_${padCell(a.bv)}=${a.prod} A${b.i}_${padCell(b.av)}*B${b.j}_${padCell(b.bv)}=${b.prod}`
            if (p === 0) {
              sum = pairSum
              log(`${lhs} ${a.prod}+${b.prod}=${pairSum} sum=${pairSum}`)
            } else {
              const prev = sum, newSum = prev + pairSum
              log(`${lhs} ${a.prod}+${b.prod}=${pairSum} ${prev}+${pairSum}=${newSum} sum=${newSum}`)
              sum = newSum
            }
            p += 2
          } else {
            const a = emitProduct(p)
            const consumed = p + 1
            const lhs = `[${consumed}/${n}] A${a.i}_${padCell(a.av)}*B${a.j}_${padCell(a.bv)}=${a.prod}`
            if (p === 0) {
              sum = a.prod
              log(`${lhs} sum=${a.prod}`)
            } else {
              const prev = sum, newSum = prev + a.prod
              log(`${lhs} ${prev}+${a.prod}=${newSum} sum=${newSum}`)
              sum = newSum
            }
            p += 1
          }
        }
      }

      const total = sum + carry
      log(`sum+c${carry}=${total}`)
      const cell = total % CELL_MAX
      const newCarry = Math.floor(total / CELL_MAX)
      out.push(cell)
      log(`O${k}_${padCell(cell)} c${newCarry}`)
      carry = newCarry
    }
    out.push(carry)
    log(`k=${N + M - 1}`)
    log(`O${N + M - 1}_${padCell(carry)}`)

    if (topLevel) {
      log(`RETURN ${tapeFmt(out, "O")}`)
    } else {
      log(`SUB_RETURN ${tapeFmt(out, "O")}`)
      log("END_SUB")
    }

    return tapeToBigInt(out)
  }

  // ----- Karatsuba wrapper -----

  function karatsubaMultiply(
    a: bigint,
    b: bigint,
    log: (...args: string[]) => void,
    topLevel: boolean
  ): bigint {
    const N = Math.max(digitsOfBig(a), digitsOfBig(b))

    // Externalize the dispatch as two tokens: N=X KT=Y on one line, then
    // the comparison result (N<=KT or N>KT) on the next. The next opcode
    // (SUB for cross-memo, KARATSUBA for the split) follows deterministically
    // from the comparison. The model never has to remember KT — it reads
    // it on the line and computes a bounded comparison one step back.
    log(`N=${N} KT=${karatsubaThreshold}`)
    if (N <= karatsubaThreshold) {
      log(`N<=KT`)
      return crossMemoMultiply(a, b, log, topLevel)
    }
    log(`N>KT`)

    const half = Math.ceil(N / 2)
    const split = 10n ** BigInt(half)
    const aHi = a / split, aLo = a % split
    const bHi = b / split, bLo = b % split

    log(`KARATSUBA half=${half}`)
    log(`A_HI=${aHi} A_LO=${aLo}`)
    log(`B_HI=${bHi} B_LO=${bLo}`)

    log(`CALL z0 = A_LO*B_LO = ${aLo}*${bLo}`)
    const z0 = karatsubaMultiply(aLo, bLo, log, false)
    log(`RET z0=${z0}`)

    log(`CALL z2 = A_HI*B_HI = ${aHi}*${bHi}`)
    const z2 = karatsubaMultiply(aHi, bHi, log, false)
    log(`RET z2=${z2}`)

    const sx = aHi + aLo, sy = bHi + bLo
    log(`sx = ${aHi}+${aLo} = ${sx}`)
    log(`sy = ${bHi}+${bLo} = ${sy}`)

    log(`CALL z3 = sx*sy = ${sx}*${sy}`)
    const z3 = karatsubaMultiply(sx, sy, log, false)
    log(`RET z3=${z3}`)

    const z3MinusZ2 = z3 - z2
    const z1 = z3MinusZ2 - z0
    log(`z1step1 = z3-z2 = ${z3}-${z2} = ${z3MinusZ2}`)
    log(`z1 = z1step1-z0 = ${z3MinusZ2}-${z0} = ${z1}`)

    const shiftHi = z2 * (10n ** BigInt(2 * half))
    const shiftMid = z1 * (10n ** BigInt(half))
    log(`shift_z2 = z2*10^${2 * half} = ${shiftHi}`)
    log(`shift_z1 = z1*10^${half} = ${shiftMid}`)

    const partial = shiftHi + shiftMid
    log(`partial = shift_z2+shift_z1 = ${shiftHi}+${shiftMid} = ${partial}`)

    const result = partial + z0
    log(`result = partial+z0 = ${partial}+${z0} = ${result}`)

    return result
  }

  return function multiply(
    numA: number | string,
    numB: number | string
  ): string {
    const decA = typeof numA === "string"
      ? (numA.includes(":") ? fromPositional(numA) : numA)
      : numA.toString(10)
    const decB = typeof numB === "string"
      ? (numB.includes(":") ? fromPositional(numB) : numB)
      : numB.toString(10)

    const a = BigInt(decA), b = BigInt(decB)

    let output = ""
    const log = (...args: string[]) => {
      output += args.join("\n") + "\n"
    }

    log("START")
    log(`A=${a} B=${b}`)
    const result = karatsubaMultiply(a, b, log, true)
    // Karatsuba path: result already exists as integer in the trace
    // (`result = partial+z0 = X+Y = Z`). Emit a terminal RETURN <int>.
    // Cross-memo path: crossMemoMultiply already emitted `RETURN O0_.. ..`
    // in cell-form when topLevel=true — no further RETURN needed.
    const N = Math.max(digitsOfBig(a), digitsOfBig(b))
    if (N > karatsubaThreshold) {
      log(`RETURN ${result}`)
    }

    if (result !== a * b) {
      throw new Error(`eval produced wrong product: ${a}*${b} expected=${a*b} got=${result}`)
    }
    return output.trim()
  }
}

export default makeMultiply(2, 8)  // chunk=2, Karatsuba fires above 8-digit
