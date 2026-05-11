import { fromPositional } from "../encoding"

/**
 * Cross-multiplication via the Tanton "sliding strip" reformulation.
 *
 * Same convolution as arithmetic-2026-cross-memo, but B is reversed
 * into an `R` tape so that the model never has to compute `j = k - i`.
 * For each k, the pair at index i is `A[i] * R[t]` where
 *   t = i + t0   and   t0 = M-1-k
 * Both `i` and `t` increment by 1 across a row — monotonic in lockstep.
 * `t0` is written ONCE per row in the RESUME line so the model only
 * subtracts once per row instead of once per pair.
 *
 * Mathematically R[t] = B[M-1-t], which gives A[i] * R[t] =
 * A[i] * B[M-1-t] = A[i] * B[M-1-(i+M-1-k)] = A[i] * B[k-i] — the
 * standard convolution coefficient at diagonal k.
 */

type CellTape = number[]

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

  function multiplySlide(
    A: CellTape,
    B: CellTape,
    log: (...args: string[]) => void
  ): CellTape {
    const N = A.length
    const M = B.length
    // R[t] = B[M-1-t]. Built once; emitted in every REFRESH.
    const R: CellTape = B.slice().reverse()
    const out: CellTape = []
    let carry = 0
    const REFRESH_INTERVAL = 16

    for (let k = 0; k < N + M - 1; k++) {
      const pairs: Array<{ i: number; t: number }> = []
      const iMin = Math.max(0, k - (M - 1))
      const iMax = Math.min(N - 1, k)
      for (let i = iMin; i <= iMax; i++) {
        // t = i + (M-1-k). Increments with i by 1.
        pairs.push({ i, t: i + (M - 1 - k) })
      }

      const tick = k % REFRESH_INTERVAL
      const isFire = tick === 0
      const action = isFire ? "FIRE" : "SKIP"
      const prev = k === 0 ? "none" : `O${k - 1}_${padCell(out[k - 1])}`
      // tick=N/M is an externalized 0..M-1 cycle counter — model
      // increments by 1 per row and wraps at M. FIRE when tick=0.
      // Replaces an implicit `k % REFRESH_INTERVAL` computation per
      // row, which the model got wrong at large k (writing SKIP at
      // k=64 instead of FIRE).
      // i0, t0 = starting indices for this row. Both increment by 1
      // per pair (lockstep). One of i0, t0 is always 0:
      //   first half (k < M-1): i0=0, t0=M-1-k
      //   second half (k >= M-1): i0=k-M+1, t0=0
      const i0 = iMin
      const t0 = i0 + (M - 1 - k)
      // iLast = i for the LAST pair in this row. Copy-friendly:
      //   first half  (k < N-1): iLast = k       (copy k value from earlier on the line)
      //   second half (k >= N-1): iLast = N-1    (constant 63 for 64-cell operands)
      // Replaces `pairs=N` which required the model to write an
      // incremented value each row — the model dropped the +1 at
      // FIRE-boundary cognitive load. iLast is pure copy or constant.
      const iLast = iMax
      log(`RESUME k=${k} tick=${tick}/${REFRESH_INTERVAL} ${action} carry=${carry} prev=${prev} i0=${i0} iLast=${iLast} t0=${t0}`)
      if (isFire) {
        log("REFRESH")
        log(tapeFmt(A, "A"))
        log(tapeFmt(R, "R"))
        // OUT: cells emitted so far, re-printed in the same TAPE_CHUNK=8
        // shape as A/R. Carries the partial answer forward so the final
        // RETURN can transcribe from the most recent OUT tape (recent,
        // bounded attention reach) plus the few cells emitted since,
        // instead of doing a 128-deep attention scan over scattered
        // `O<k>_..` lines. The range header `O0..O<k-1>` forces a FULL
        // re-emit semantics — without it the model treats OUT as a
        // delta from the previous FIRE and skips the early cells.
        if (out.length > 0) {
          log(`OUT O0..O${out.length - 1}`)
          log(tapeFmt(out, "O"))
        }
        log("END_REFRESH")
      }

      let sum = 0
      if (pairs.length === 0) {
        log("0")
      } else {
        let p = 0
        const emitProduct = (idx: number) => {
          const { i, t } = pairs[idx]
          return { i, t, av: A[i], rv: R[t], prod: A[i] * R[t] }
        }
        // `[iCurrent/iLast]` per pair line — iCurrent is the i value
        // of the LAST pair on this line; iLast is copied from RESUME.
        // Both increment by 1 (or 2 for double-pair lines) per line,
        // both monotonic. Row-end is `[iLast/iLast]`, unambiguous.
        // Pure copy / counter ops, no diagonal recomputation.
        while (p < pairs.length) {
          if (p + 1 < pairs.length) {
            const a = emitProduct(p)
            const b = emitProduct(p + 1)
            const pairSum = a.prod + b.prod
            const lhs = `[${b.i}/${iLast}] A${a.i}_${padCell(a.av)}*R${a.t}_${padCell(a.rv)}=${a.prod} A${b.i}_${padCell(b.av)}*R${b.t}_${padCell(b.rv)}=${b.prod}`
            if (p === 0) {
              sum = pairSum
              log(`${lhs} ${a.prod}+${b.prod}=${pairSum}`)
            } else {
              const prev = sum
              const newSum = prev + pairSum
              log(`${lhs} ${a.prod}+${b.prod}=${pairSum} ${prev}+${pairSum}=${newSum}`)
              sum = newSum
            }
            p += 2
          } else {
            const a = emitProduct(p)
            const lhs = `[${a.i}/${iLast}] A${a.i}_${padCell(a.av)}*R${a.t}_${padCell(a.rv)}=${a.prod}`
            if (p === 0) {
              sum = a.prod
              log(lhs)
            } else {
              const prev = sum
              const newSum = prev + a.prod
              log(`${lhs} ${prev}+${a.prod}=${newSum}`)
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
    log(`RESUME k=${N + M - 1} END carry=${carry}`)
    log(`O${N + M - 1}_${padCell(carry)}`)

    return out
  }

  return function multiply(numA: number | string, numB: number | string): string {
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

    log(`CHUNK=${chunk}`)
    const productTape = multiplySlide(tapeA, tapeB, log)

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

export default makeMultiply(2)
