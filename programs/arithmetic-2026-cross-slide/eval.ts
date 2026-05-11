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
    const REFRESH_INTERVAL = 12

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
      const iLast = iMax
      const t0 = i0 + (M - 1 - k)
      // Emit only the non-zero of (i0, t0) — the other is implicitly 0.
      // First-half rows (and peak) have t0 ≥ 0 and i0 = 0 → emit `t0=X`.
      // Second-half rows have t0 = 0 and i0 > 0 → emit `i0=X`.
      // This makes the RESUME line shape itself signal which half we're
      // in (the *field name* differs), and removes the chance for the
      // model to emit a wrong constant for the field that's "supposed
      // to be 0" — there's no such field to write.
      const offsetField = t0 > 0 || (t0 === 0 && i0 === 0)
        ? `t0=${t0}`   // first half + peak (t0 ≥ 0; i0 implicit 0)
        : `i0=${i0}`   // second half (i0 > 0; t0 implicit 0)
      log(`RESUME k=${k} tick=${tick}/${REFRESH_INTERVAL} ${action} carry=${carry} prev=${prev} iLast=${iLast} ${offsetField}`)
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
        // One pair per line. Label `[i/iLast]` where i is THE pair's i
        // index (not a step counter). Increment by 1 per line. Row-end
        // is unambiguously `[iLast/iLast]` — single rule, no parity
        // branching, no double/single distinction.
        //
        // Per-line format (chunk=2 decomp):
        //   [i/iLast] A_i_av*R_t_rv: rvHi*av=P1 rvLo*av=P2 P1*10=P1s P1s+P2=prod prev+prod=newSum
        //
        // First pair in row has no `prev+prod=` suffix — running sum
        // starts at `prod`. Subsequent lines add to it.
        // Hybrid decomp:
        //   Leaves use `digit|product` notation — lookup from A_i's T row.
        //   No mental 1d×2d arithmetic; model finds the row, reads the
        //   entry for the digit, transcribes.
        //   Combine uses explicit equation `P1*10+P2=prod` — the model
        //   must commit to the operation and the result together, so a
        //   slip on `prod` shows up as a broken equation rather than a
        //   silently-wrong bare number. (Previously emitting just the
        //   bare prod let the model emit a wrong value with no anchor.)
        //
        // Trivial cases (rv=0 → both digits 0) emit:
        //   0|0 0|0 0*10+0=0
        // Same shape as non-trivial, model can't compress by recognizing
        // triviality.
        const useDecomp = chunk === 2
        const fmtDecomp = (av: number, rv: number, prod: number): string => {
          if (!useDecomp) return `=${prod}`
          const rvHi = Math.floor(rv / 10)
          const rvLo = rv % 10
          const p1 = av * rvHi
          const p2 = av * rvLo
          return `: ${rvHi}|${p1} ${rvLo}|${p2} ${p1}*10+${p2}=${prod}`
        }
        // Uniform pair-line shape: EVERY line ends with an explicit
        // `prev+prod=newSum` running-sum update, including the first
        // pair where `prev=0`. The asymmetric "first line ends at =prod"
        // shape let the model emit a standalone `prod` line trying to
        // anchor the running sum it couldn't see explicitly.
        while (p < pairs.length) {
          const a = emitProduct(p)
          const aOp = `A${a.i}_${padCell(a.av)}*R${a.t}_${padCell(a.rv)}`
          const aDecomp = `${aOp}${fmtDecomp(a.av, a.rv, a.prod)}`
          const prev = sum
          const newSum = prev + a.prod
          log(`[${a.i}/${iLast}] ${aDecomp} ${prev}+${a.prod}=${newSum}`)
          sum = newSum
          p += 1
        }
      }

      const total = sum + carry
      const cell = total % CELL_MAX
      const newCarry = Math.floor(total / CELL_MAX)
      out.push(cell)
      // Chained equation: `row_sum + carry_in = total = carry_out*BASE + cell`.
      // One line asserts BOTH the addition (how `total` was formed from
      // the row's running sum + carry-in) AND the decomposition (how
      // `total` splits into the next row's carry and this row's cell).
      // The middle `total` is the join — if any computation is wrong
      // the chain visibly breaks.
      log(`${sum}+${carry}=${total}=${newCarry}*${CELL_MAX}+${cell}`)
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
    // Memoization table T removed: the pair-line decomp leaves
    // (`<digit>|<product>`) are 1d×2d products the model does
    // reliably in-line. The table was only visible to the very
    // first chunk anyway — trim-mode continuations slice from the
    // first FIRE, dropping the body of T from the assistant prefill.
    // Testing whether removing it degrades reliability.
    const productTape = multiplySlide(tapeA, tapeB, log)

    log(`RETURN ${tapeFmt(productTape, "O")}`)
    // Explicit end-of-program marker. Paired with `stopSequences:
    // ["DONE"]` on the API call so the model halts naturally at end.
    // Without this marker the model emitted O<final>_.. then drifted
    // into prose ("Now I need to compute…") instead of recognizing
    // the program had ended.
    log("DONE")

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
