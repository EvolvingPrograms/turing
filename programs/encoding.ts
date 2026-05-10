/**
 * Encoding helpers for the Turing-machine-tape programs.
 *
 * Programs that share an encoding format (e.g. positional binary, positional
 * hex, block-char tape) import these functions and pass them to defineProgram
 * via the `encode` field. The lib in src/lib does not depend on any of this
 * — encoding is a downstream concern owned by each program.
 */

/** Block-character format: 0 -> ░, 1 -> █. Accepts a string of digits or a number array. */
export function format(tape: string | number[], join = ""): string {
  if (Array.isArray(tape)) tape = tape.join("")
  tape = tape.replace(/0/g, "░").replace(/1/g, "█")
  return tape.split("").join(join)
}

/** Tape with bare integer index per cell: [1,0,1] -> "01 10 21". */
export function positions(tape: string[] | number[]): string {
  return tape.map((v, i) => `${i}${v}`).join(" ")
}

/** Tape with prefix+index+block-char: prefix="A" + [1,0,1] -> "A0█ A1░ A2█". */
export function positionFormat(tape: (0 | 1)[], prefix = ""): string {
  return tape.map((v, i) => `${`${prefix}${i}`}${format([v])}`).join(" ")
}

/**
 * Trace-emitting integer-to-binary conversion, MSB-first.
 * The optional `log` callback receives intermediate computation lines for
 * inclusion in a tape (used by the automata program). Returns the binary
 * string.
 */
export function integerToBinaryTape(
  num: number,
  log?: (...args: string[]) => void
): string {
  if (num < 0) {
    throw new Error("Only non-negative integers are supported.")
  }

  let binary = ""

  while (num > 0) {
    const quotient = Math.floor(num / 2)
    const remainder = num % 2

    const indexLabel = `${binary.length}`.padEnd(3)

    log?.(`${indexLabel} ${num} ${quotient} ${remainder} ${format([remainder])} ${binary.length}${format([remainder])}`)

    binary = remainder + binary
    num = quotient
  }

  const binaryTape = binary.split("").map(Number) as (0 | 1)[]

  log?.("REINDEX")
  for (let i = binaryTape.length - 1; i >= 0; i--) {
    const newIndex = binaryTape.length - (i + 1)
    log?.(`${i}${format([binaryTape[newIndex]])} ${newIndex}${format([binaryTape[newIndex]])}`)
  }

  return binary
}

/** Trace-emitting binary-to-integer conversion. Reverse of integerToBinaryTape. */
export function binaryTapeToInteger(
  tape: (0|1)[],
  log?: (...args: string[]) => void
): number {
  let num = 0
  let power = 0

  for (let i = tape.length - 1; i >= 0; i--) {
    const bit = tape[i]
    const scale = Math.pow(2, power)
    const bitValue = bit * scale

    log?.(`${i} ${scale}  ${num} ${bit} ${bitValue} ${format([bit])} → ${num}${format([bit])}`)

    num += bitValue
    power++
  }

  return num
}

/** Encode a string or number to positional form: "abc" -> "0:a 1:b 2:c". Optional prefix tags each entry. */
export const toPositional = (value: string | number, prefix?: string): string => {
  return value.toString().split("").map((v, i) => `${prefix ?? ""}${i}:${v}`).join(" ")
}

/** Inverse of toPositional. "0:a 1:b 2:c" -> "abc". */
export const fromPositional = (positional: string): string => {
  return positional.split(/\s+/).map((v) => v.split(":")[1]).join("")
}

/** Convert a non-negative integer to positional binary, MSB-first. e.g. 5 -> "0:1 1:0 2:1". */
export const toPositionalBinary = (num: number): string => {
  return toPositional(num.toString(2))
}

/** Convenience: map an array of integers to positional binary strings. */
export const toPositionalBinaries = (nums: number[]): string[] => {
  return nums.map(toPositionalBinary)
}

/** Inverse: parse a positional binary string back to a number. */
export const fromPositionalBinary = (positionalBinary: string): number => {
  const binary = fromPositional(positionalBinary)
  return parseInt(binary, 2)
}

/** Convert a hex string ("a3f") to positional hex, MSB-first: "0:a 1:3 2:f". Strips leading "0x", lowercases. */
export const toPositionalHex = (hex: string): string => {
  const normalized = hex.toLowerCase().replace(/^0x/i, "")
  return toPositional(normalized)
}

/** Inverse: parse positional hex back to a lowercase hex string (no "0x"). */
export const fromPositionalHex = (positionalHex: string): string => {
  return fromPositional(positionalHex)
}
