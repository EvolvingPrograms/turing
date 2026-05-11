import { fromPositional } from "../encoding"

/**
 * Cross-multiplication with memoized base — same Urdhva-Tiryak / Trachtenberg
 * algorithm as arithmetic-2026-cross, but operates on `chunk`-digit cells
 * instead of single decimal digits. The model is asked to memorize / mentally
 * compute each cell-by-cell multiplication (e.g. with chunk=2, products like
 * 47*83=3901 are emitted as a single line). The cross algorithm is unchanged
 * in shape; only the unit of computation changes.
 *
 * - chunk=1 → equivalent to plain arithmetic-2026-cross (base 10).
 * - chunk=2 → base-100, 2-digit × 2-digit memorized (max 99*99=9801).
 * - chunk=3 → base-1000, 3-digit × 3-digit memorized (max 999*999=998001).
 * - chunk=4+ → progressively more aggressive; relies on Claude's reliability
 *   for larger mental multiplications.
 *
 * Returns a multiply function bound to the given chunk size. Use the factory
 * so each invocation of the program can vary chunk via CLI flag without
 * mutating module-level state.
 */

type CellTape = number[]

// Cells per line in tape display. Wider lines = fewer lines per tape, which
// matters for REFRESH reliability: the model can't count 16+ structurally-
// identical lines accurately. With TAPE_CHUNK=8, a 64-cell tape is 8 lines;
// each REFRESH is ~17 lines total (A + B + markers), within counting range.
const TAPE_CHUNK = 8

export function makeMultiply(chunk: number) {
  if (!Number.isInteger(chunk) || chunk < 1 || chunk > 6) {
    throw new Error(`chunk must be an integer 1..6, got: ${chunk}`)
  }
  const BASE = 10n ** BigInt(chunk)
  const CELL_MAX = Number(BASE)

  function digitsToTape(digits: string): CellTape {
    const pad = digits.length % chunk === 0 ? 0 : chunk - (digits.length % chunk)
    const padded = "0".repeat(pad) + digits
    const tape: CellTape = []
    for (let i = padded.length; i > 0; i -= chunk) {
      const cellStr = padded.slice(i - chunk, i)
      const value = parseInt(cellStr, 10)
      if (!Number.isInteger(value) || value < 0 || value >= CELL_MAX) {
        throw new Error(`Bad cell: ${cellStr}`)
      }
      tape.push(value)
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
    for (let i = tape.length - 1; i >= 0; i--) {
      acc = acc * BASE + BigInt(tape[i])
    }
    return acc
  }

  function multiplyCross(
    A: CellTape,
    B: CellTape,
    log: (...args: string[]) => void
  ): CellTape {
    const N = A.length
    const M = B.length
    const out: CellTape = []
    let carry = 0

    // REFRESH every REFRESH_INTERVAL iterations. Each iteration emits an
    // explicit `tick=N [FIRE|SKIP]` line *before* the k= header. tick cycles
    // 0..REFRESH_INTERVAL-1. When tick=0 the action is [FIRE] and a REFRESH
    // block follows; otherwise the action is [SKIP] and the iteration proceeds
    // directly to its k= header.
    //
    // The point: the model never has to internally track "is this a refresh
    // iteration." Every iteration tells the model its own action explicitly.
    // Cycle position is bounded (0..7) and incremented one-at-a-time. This
    // is the deterministic-single-direction principle applied to the refresh
    // trigger.
    const REFRESH_INTERVAL = 8

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

        // Make every addition step explicit on the line: pair sum
        // (prod1+prod2) and running sum (prev+pair) are each shown as
        // separate 2-operand equations. The model never has to compute
        // an implicit intermediate — each value it writes is verifiable
        // against the operands on the same line. The previous running
        // sum is always visible (it's the last `=N` on the previous
        // line) so the model only attends 1 line back for it.
        // Each line starts with `[i/n]` — i = pairs consumed AFTER this
        // line, n = total pairs in this k-row. Front-loading position info
        // follows the left-to-right principle: the model writes its
        // position label before computing anything, so the position
        // constraint applies during the rest of the line. End-of-row is
        // unambiguous (next line starts with `[n/n]`'s successor →
        // `sum+c=…`). Mid-row is unambiguous too (next line starts with
        // `[k/n]` for k < n → another pair). On continuation after an
        // overflow, the prefill ends at the prior line's newline; the
        // model's first emission on the new line is `[k/n]` which forces
        // the correct branch.
        const n = pairs.length
        while (p < pairs.length) {
          if (p + 1 < pairs.length) {
            const a = emitProduct(p)
            const b = emitProduct(p + 1)
            const pairSum = a.prod + b.prod
            const consumed = p + 2
            const lhs = `[${consumed}/${n}] A${a.i}_${padCell(a.av)}*B${a.j}_${padCell(a.bv)}=${a.prod} A${b.i}_${padCell(b.av)}*B${b.j}_${padCell(b.bv)}=${b.prod}`
            if (p === 0) {
              sum = pairSum
              log(`${lhs} ${a.prod}+${b.prod}=${pairSum} sum=${pairSum}`)
            } else {
              const prev = sum
              const newSum = prev + pairSum
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
              const prev = sum
              const newSum = prev + a.prod
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

    return out
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

    const tapeA = digitsToTape(decA)
    const tapeB = digitsToTape(decB)

    let output = ""
    const log = (...args: string[]) => {
      output += args.join("\n") + "\n"
    }

    log("START")
    log(`CHUNK=${chunk}`)
    const productTape = multiplyCross(tapeA, tapeB, log)

    log(`RETURN ${tapeFmt(productTape, "O")}`)

    const expected = tapeToBigInt(tapeA) * tapeToBigInt(tapeB)
    const actual = tapeToBigInt(productTape)
    if (expected !== actual) {
      throw new Error(
        `eval.ts produced wrong product: a=${tapeToBigInt(tapeA)} b=${tapeToBigInt(tapeB)} expected=${expected} got=${actual}`
      )
    }

    return output.trim()
  }
}

// Default export keeps the same shape as other programs' eval defaults so
// scripts that call eval directly without specifying a chunk still work.
export default makeMultiply(2)
