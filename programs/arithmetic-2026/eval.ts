import { fromPositional } from "../utils"

/**
 * MSB-first nibble tape. Mirrors the array convention of arithmetic-tape's
 * bit tape, just at 4-bit granularity. Element 0 is the most significant
 * nibble; element N-1 is the least significant.
 *
 * I/O format follows the existing positional convention but with hex digits
 * instead of bits, e.g. `0:f 1:1 2:a 3:c` for 0xf1ac (MSB-first, position 0
 * is the leading nibble).
 */
export type Nibble = number  // 0..15
export type NibbleTape = Nibble[]

const hex = (n: number) => n.toString(16)

function nibbleArrayFmt(tape: NibbleTape, prefix: string): string {
  return tape.map((v, i) => `${prefix}${i}_${hex(v)}`).join(" ")
}

function hexStringToTape(hexStr: string): NibbleTape {
  const cleaned = hexStr.replace(/^0x/i, "").toLowerCase()
  const padded = cleaned.length === 0 ? "0" : cleaned
  return padded.split("").map(c => parseInt(c, 16))
}

function tapeToBigInt(tape: NibbleTape): bigint {
  let acc = 0n
  for (const n of tape) acc = (acc << 4n) | BigInt(n)
  return acc
}

function multiplyNibbleTapes(
  tapeA: NibbleTape,
  tapeB: NibbleTape,
  log: (...args: string[]) => void
): NibbleTape {
  const output: NibbleTape = new Array(tapeA.length + tapeB.length).fill(0)

  log(nibbleArrayFmt(tapeA, "A"))
  log(nibbleArrayFmt(tapeB, "B"))

  for (let i = tapeB.length - 1; i >= 0; i--) {
    const headB = tapeB[i]
    const topPos = i + tapeA.length

    log(`B${i}_${hex(headB)} ${topPos} ${topPos - 1}`)

    if (headB === 0) {
      continue
    }

    let carry = 0

    for (let j = tapeA.length - 1; j >= 0; j--) {
      const headA = tapeA[j]
      const position = i + j + 1
      const oldO = output[position]
      const product = headA * headB
      const partial = product + oldO
      const total = partial + carry
      const newNibble = total & 0xf
      const newCarry = total >> 4

      // Five-line decomposed inner step. Each transition is a single
      // 2-operand op: multiply, add-O, add-carry, split. The 3-operand
      // add was where the model slipped on wider tapes — splitting it
      // into two 2-operand adds keeps every step trivial.
      output[position] = newNibble
      log(`B${i}_${hex(headB)} A${j}_${hex(headA)} O${position}_${hex(oldO)} c${hex(carry)} ${hex(headA)}*${hex(headB)}=${hex(product)} ${hex(product)}+${hex(oldO)}=${hex(partial)} ${hex(partial)}+${hex(carry)}=${hex(total)} O${position}_${hex(newNibble)} c${hex(newCarry)}`)

      carry = newCarry
    }

    output[i] = (output[i] + carry) & 0xf
    log(`O${i}_${hex(output[i])}`)
  }

  log(nibbleArrayFmt(output, "O"))
  return output
}

export default function multiply(
  numA: number | string,
  numB: number | string
): string {
  const hexA = typeof numA === "string"
    ? (numA.includes(":") ? fromPositional(numA) : numA.replace(/^0x/i, "").toLowerCase())
    : numA.toString(16)

  const hexB = typeof numB === "string"
    ? (numB.includes(":") ? fromPositional(numB) : numB.replace(/^0x/i, "").toLowerCase())
    : numB.toString(16)

  const tapeA = hexStringToTape(hexA)
  const tapeB = hexStringToTape(hexB)

  let output = ""
  const log = (...args: string[]) => {
    output += args.join("\n") + "\n"
  }

  log("START")
  log("PREPARE")
  const productTape = multiplyNibbleTapes(tapeA, tapeB, log)

  log(`RETURN ${nibbleArrayFmt(productTape, "")}`)

  // Sanity: BigInt cross-check. Throws if the trace's tape is wrong.
  const expected = tapeToBigInt(tapeA) * tapeToBigInt(tapeB)
  const actual = tapeToBigInt(productTape)
  if (expected !== actual) {
    throw new Error(
      `eval.ts produced wrong product: a=${tapeToBigInt(tapeA).toString(16)} b=${tapeToBigInt(tapeB).toString(16)} expected=${expected.toString(16)} got=${actual.toString(16)}`
    )
  }

  return output.trim()
}
