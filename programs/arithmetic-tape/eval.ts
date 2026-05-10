import { format, fromPositionalBinary, positionFormat } from "../encoding"

export type TapeValue = 0 | 1
export type Tape = TapeValue[]


function intToTape(num: number): Tape {
  const binary = num.toString(2)
  return binary.split("").map(v => Number(v) as TapeValue)
}

function multiplyTapes(
  tapeA: Tape, 
  tapeB: Tape, 
  log: (...args: string[]) => void
): Tape {
  const output: Tape = new Array(tapeA.length + tapeB.length).fill(0)

  log(positionFormat(tapeA, "A"))
  log(positionFormat(tapeB, "B"))
  // log(`JOIN ${keys.map((k) => k.padStart(2)).join(" ")}`)
  // log(`JOIN ${Object.keys(keys).map((k) => k.padStart(2)).join(" ")}`)

  log("\nJOIN")
  let joinedIndex = 0

  // log("\n")
  for (let i = 0; i < tapeA.length; i++) {
    log(`A${i} O${joinedIndex}`)
    joinedIndex++
  }
  
  for (let i = 0; i < tapeB.length; i++) {
    log(`B${i} O${joinedIndex}`)
    joinedIndex++
  }

  // log(positionFormat(output, "O"))

  let skipped = false
  for (let i = tapeB.length - 1; i >= 0; i--) {
    if (!skipped) {
      log(`${positionFormat(tapeA, "A")}`)
      log(`${positionFormat(tapeB, "B")}`)
      // log("LOOP B")
    }

    skipped = false
    const headB = tapeB[i]
    const headBFmt = format([headB])
    log(`B${i}${headBFmt} ${i + tapeA.length} ${i + tapeA.length - 1}`)

    if (!headB) {
      skipped = true
      continue
    }

    let carry: TapeValue = 0

    // log("LOOP A OUTPUT")
    for (let j = tapeA.length - 1; j >= 0; j--) {
      const headA = tapeA[j]
      const headAFmt = format([headA])
      const position = i + j + 1
      const sum = tapeA[j] + output[position] + carry
      const remainder = sum % 2 as TapeValue

      // Logging each step of the computation
      log(`B${i}${headBFmt} A${j}${headAFmt} O${position}${format([output[position]])}`)

      if (carry || sum) {
        log(`${carry} ${sum}`)
      }

      // if (carry) {
      //   log(`CARRY ${carry}`)
      // }

      // if (sum) {
      //   log(`SUM ${sum}`)
      // }

      // if (remainder) {
      //   log(`REM ${remainder}`)
      // }

      // const remainderLabel = remainder ? ` REM ${remainder}` : ""
      // log(`SUM ${sum}${remainderLabel}`)

      output[position] = remainder // Update the result tape at the current position
      log(`O${position}${format([remainder])}`)

      carry = Math.floor(sum / 2) as TapeValue
      // Logging after setting the bit and carry
      if (carry) {
        log(`${carry}`)
      }
    }

    // log("LOOP A OUTPUT END")

    if (carry) {
      output[i] = carry as TapeValue
      log(`O${i}${format([carry])}`)
    } else {
      log(`O${i}${format([output[i]])}`)
    }
    
    // log(`OUTPUT ${positionFormat(result)}`)
    log(positionFormat(output, "O"))
  }

  // log(`OUTPUT ${positionFormat(result)}`)
  return output
}

export default function multiply(
  num1: number | string, 
  num2: number | string
): string {
  if (typeof num1 === "string") num1 = fromPositionalBinary(num1)
  if (typeof num2 === "string") num2 = fromPositionalBinary(num2)

  let output = ""
  const log = (...args: string[]) => {
    output += args.join("\n") + "\n"
  }

  log("START")
  // log(`${num1} x ${num2}`)

  // log(`A: ${num1} TO BINARY`)
  // const binaryA = integerToBinaryTape(num1, log).split("").map(Number) as Tape

  // log(`B: ${num2} TO BINARY`)
  // const binaryB = integerToBinaryTape(num2, log).split("").map(Number) as Tape

  const tapeA = intToTape(num1)
  const tapeB = intToTape(num2)

  log("PREPARE")
  const productTape = multiplyTapes(tapeA, tapeB, log)

  // log("")
  log(`RETURN ${positionFormat(productTape)}`)
  // log("FROM BINARY")
  // const product = binaryTapeToInteger(productTape, log)
  // log(`RETURN ${product}`)

  // const product = tapeToInt(productTape)

  // log(`Product Tape: ${format(productTape)}`)
  // log(`Product: ${product}`)
  // log(`Reference: ${num1 * num2}`)

  return output.trim()
}

// Example usage:
// const num1 = 41
// const num2 = 22

// const result = multiplyLargeIntegers(num1, num2)
// console.log(result)