import chalk from "chalk"

export function checkRollingSolution(output: string, solution: string) {
  const correct = solution.trim()
  const actual = output.trim()

  if (!correct.startsWith(actual)) {
    console.log()
    console.log(chalk.bold(chalk.red("INCORRECT")))
    console.log(chalk.red("Output did not match solution."))
    console.log()

    let i = 0
    const correctLines = correct.split("\n")
    const actualLines = actual.split("\n")
    while (i < actualLines.length) {
      const correctLine = (correctLines?.[i] || "").padEnd(60)
      const actualLine = (actualLines?.[i] || "").padEnd(60)
      const isCorrect = correctLine.trim() === actualLine.trim()

      console.log(
        `${chalk.green(correctLine)} | ${isCorrect ? chalk.dim(chalk.green(actualLine)) : chalk.red(actualLine)}`
      )

      i++
    }

    console.log()
    return false
  }

  return true
}

export const substringEndsAt = (text1: string, text2: string) => {
  if (text1 === text2) {
    return text1.length
  }

  let i = 0
  while (i < text1.length) {
    if (!text2.startsWith(text1.slice(0, i))) {
      return i
    }

    i++
  }

  return i
}
