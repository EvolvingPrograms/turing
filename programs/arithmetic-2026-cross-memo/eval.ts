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

const TAPE_CHUNK = 4  // cells per line in the tape display (attention width)

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

    log(tapeFmt(A, "A"))
    log(tapeFmt(B, "B"))

    for (let k = 0; k < N + M - 1; k++) {
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

        while (p < pairs.length) {
          if (p + 1 < pairs.length) {
            const a = emitProduct(p)
            const b = emitProduct(p + 1)
            const pairSum = a.prod + b.prod
            const lhs = `A${a.i}_${padCell(a.av)}*B${a.j}_${padCell(a.bv)}=${a.prod} A${b.i}_${padCell(b.av)}*B${b.j}_${padCell(b.bv)}=${b.prod}`
            if (p === 0) {
              sum = pairSum
              log(`${lhs} sum=${pairSum}`)
            } else {
              const newSum = sum + pairSum
              log(`${lhs} sum+${pairSum}=${newSum}`)
              sum = newSum
            }
            p += 2
          } else {
            const a = emitProduct(p)
            const lhs = `A${a.i}_${padCell(a.av)}*B${a.j}_${padCell(a.bv)}=${a.prod}`
            if (p === 0) {
              sum = a.prod
              log(`${lhs} sum=${a.prod}`)
            } else {
              const newSum = sum + a.prod
              log(`${lhs} sum+${a.prod}=${newSum}`)
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
