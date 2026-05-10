import { fromPositional } from "../encoding"

/**
 * Cross-multiplication ("Urdhva-Tiryak" / Trachtenberg general method).
 *
 * Operates on decimal digits, LSB-first. For each output position k from 0 to
 * N+M-1, sum the partial products a[i] * b[j] where i + j = k, plus any carry
 * from the previous output position. The low decimal digit of the running
 * total becomes O[k]; the rest becomes the carry into k+1.
 *
 * Each multiplication is decimal x decimal (max 9*9 = 81). Accumulation is
 * decomposed into one-at-a-time 2-operand additions so no single trace line
 * has more than a 2-operand sum to compute.
 *
 * I/O format: positional decimal, MSB-first like arithmetic-2026 uses for hex.
 *   "0:4 1:7 2:8" represents 478 (position 0 = leading digit).
 *
 * Trace format (LSB-first internally; positions in trace are LSB-first):
 *
 *   START
 *   A 8 7 4
 *   B 2 3
 *   k=0 ...
 *   k=1 ...
 *   ...
 *   RETURN d0 d1 ... d(N+M-1)
 */

type DigitTape = number[]

function digitsToTape(digits: string): DigitTape {
  // input is MSB-first decimal string; convert to LSB-first array of numbers
  return digits.split("").reverse().map(c => {
    const n = Number(c)
    if (!Number.isInteger(n) || n < 0 || n > 9) {
      throw new Error(`Bad decimal digit: ${c}`)
    }
    return n
  })
}

/**
 * Emit the tape across multiple lines with at most CHUNK cells each. Long
 * single-line copies past ~8 cells drift in the middle (position-9-ish off-by-
 * one swaps); shorter lines stay attention-stable and the position labels
 * still anchor each cell.
 */
const CHUNK = 4
function tapeFmt(tape: DigitTape, prefix: string): string {
  const cells = tape.map((v, i) => `${prefix}${i}_${v}`)
  const lines: string[] = []
  for (let i = 0; i < cells.length; i += CHUNK) {
    lines.push(cells.slice(i, i + CHUNK).join(" "))
  }
  return lines.join("\n")
}

function tapeToBigInt(tape: DigitTape): bigint {
  // tape is LSB-first
  let acc = 0n
  for (let i = tape.length - 1; i >= 0; i--) {
    acc = acc * 10n + BigInt(tape[i])
  }
  return acc
}

function multiplyCross(
  A: DigitTape,
  B: DigitTape,
  log: (...args: string[]) => void
): DigitTape {
  const N = A.length
  const M = B.length
  const out: DigitTape = []
  let carry = 0

  log(tapeFmt(A, "A"))
  log(tapeFmt(B, "B"))

  for (let k = 0; k < N + M - 1; k++) {
    log(`k=${k}`)

    // Collect the (i, j) pairs for this output position.
    const pairs: Array<[number, number]> = []
    for (let i = Math.max(0, k - (M - 1)); i <= Math.min(N - 1, k); i++) {
      const j = k - i
      pairs.push([i, j])
    }

    let sum = 0
    if (pairs.length === 0) {
      log("sum=0")
    } else {
      // Pair-grouping: emit two products per line whenever possible, with the
      // pair sum implicit and the running sum updated by the combined amount.
      //
      // First two products (block opener):
      //   "A<i1>_*B<j1>_=<p1> A<i2>_*B<j2>_=<p2> sum=<p1+p2>"
      // Subsequent pairs:
      //   "A<i1>_*B<j1>_=<p1> A<i2>_*B<j2>_=<p2> sum+<p1+p2>=<newSum>"
      // Lone single (k=0, last k, or odd-count tail):
      //   "A<i>_*B<j>_=<p> sum=<p>"     (if first)
      //   "A<i>_*B<j>_=<p> sum+<p>=<newSum>" (if continuing)
      //
      // Every line has the same uniform shape — no alternation between line
      // types — and the pair-sum is the only mental step the line doesn't
      // explicitly write down.
      let p = 0
      const emitProduct = (idx: number) => {
        const [i, j] = pairs[idx]
        const prod = A[i] * B[j]
        return { i, j, av: A[i], bv: B[j], prod }
      }

      while (p < pairs.length) {
        if (p + 1 < pairs.length) {
          const a = emitProduct(p)
          const b = emitProduct(p + 1)
          const pairSum = a.prod + b.prod
          const lhs = `A${a.i}_${a.av}*B${a.j}_${a.bv}=${a.prod} A${b.i}_${b.av}*B${b.j}_${b.bv}=${b.prod}`
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
          const lhs = `A${a.i}_${a.av}*B${a.j}_${a.bv}=${a.prod}`
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

    // Add the running carry.
    const total = sum + carry
    log(`sum+c${carry}=${total}`)

    const digit = total % 10
    const newCarry = Math.floor(total / 10)
    out.push(digit)
    log(`O${k}_${digit} c${newCarry}`)

    carry = newCarry
  }

  // Final carry occupies the most significant output position.
  out.push(carry)
  log(`k=${N + M - 1}`)
  log(`O${N + M - 1}_${carry}`)

  return out
}

export default function multiply(
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
  const productTape = multiplyCross(tapeA, tapeB, log)

  log(`RETURN ${tapeFmt(productTape, "O")}`)

  // BigInt cross-check.
  const expected = tapeToBigInt(tapeA) * tapeToBigInt(tapeB)
  const actual = tapeToBigInt(productTape)
  if (expected !== actual) {
    throw new Error(
      `eval.ts produced wrong product: a=${tapeToBigInt(tapeA)} b=${tapeToBigInt(tapeB)} expected=${expected} got=${actual}`
    )
  }

  return output.trim()
}
