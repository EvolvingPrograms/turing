import { fromPositional, toPositional } from "../encoding"

function toDigitArray(n: number | string): number[] {
  if (typeof n === "string") {
    return fromPositional(n).split("").map(Number)
  } else {
    return n.toString().split("").map(Number)
  }
}

export default function multiply(a: number | string, b: number | string): string {
  // Convert inputs to digit arrays, reversed for easier manipulation
  const digitsA = toDigitArray(a)
  const digitsB = toDigitArray(b)
  const A = Number(digitsA.join(""))
  const B = Number(digitsB.join(""))

  const logs: string[] = []
  const output: number[] = new Array(digitsA.length + digitsB.length).fill(0)

  logs.push("START")
  logs.push(`${toPositional(A, "A")} ${A}`)
  logs.push(`${toPositional(B, "B")} ${B}`)
  logs.push(`${A} * ${B}`)
  digitsA.reverse()
  digitsB.reverse()

  logs.push("JOIN")
  let joinedIndex = 0
  logs.push("A:")
  for (let i = 0; i < digitsA.length; i++) {
    logs.push(`${i} ${joinedIndex}`)
    joinedIndex++
  }

  logs.push("B:")
  for (let i = 0; i < digitsB.length; i++) {
    logs.push(`${i} ${joinedIndex}`)
    joinedIndex++
  }

  // Perform the multiplication
  for (let i = 0; i < digitsB.length; i++) {
    logs.push(`LOOP B ${i}/${digitsB.length - 1}`)
    const digitB = digitsB[i]

    logs.push(`${toPositional(output.join(""), "O")}`)
    logs.push(`${toPositional(digitsA.join(""), "A")}`)
    logs.push(`${toPositional(digitsB.join(""), "B")}`)

    for (let j = 0; j < digitsA.length; j++) {
      logs.push(`LOOP A ${j}/${digitsA.length - 1} B ${i}/${digitsB.length - 1}`)
    
      const digitA = digitsA[j]
      const product = digitA * digitB
      const position = i + j

      // logs.push(`B:${i}/${digitsB.length - 1} A:${j}/${digitsA.length - 1}`)
      logs.push(`${i} ${j} ${position} ${position + 1}`)
      logs.push(`B${i}:${digitB} * A${j}:${digitA} = ${product}`)

      const current = output[position]
      const next = output[position] + product
      logs.push(`O${position}:${current} + ${product} = ${next}`)
      // logs.push(`O${position}:${current} + ${product} = O${position}${next}`)

      output[position] = next

      // Handle carry over
      let k = position
      if (output[k] >= 10) {
        logs.push("CARRY")
        while (output[k] >= 10) {
          const head = output[k]
          const next = output[k + 1]
          const tens = Math.floor(output[k] / 10)
          const remainder = output[k] % 10

          logs.push(`O${k}:${head} O${k + 1}:${next}`)
          logs.push(`O${k}:${head} ${tens} ${remainder}`)
          logs.push(`O${k + 1}:${next} + ${tens} = O${k + 1}:${next + tens}`)

          output[k + 1] += tens
          output[k] = remainder
          logs.push(`SET O${k}:${output[k]} O${k + 1}:${output[k + 1]}`)
          k++
        }
      } else {
        logs.push(`SET O${position}:${output[position]}`)
      }
    }
  }

  // Trim leading zeros from the output array
  while (output.length > 1 && output[output.length - 1] === 0) {
    output.pop()
  }

  const result = output.slice().reverse()

  // logs.push(`${toPositional(output.join(""), "O")}`)
  // logs.push(result.split("").join(" "))
  logs.push(`RETURN ${toPositional(result.join(""), "O")}`)
  logs.push(`REFERENCE ${toPositional(A * B, "O")}`)

  return logs.join("\n")
}