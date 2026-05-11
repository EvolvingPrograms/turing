import chalk from "chalk"

// Lines of matching context to show before the first divergent line.
// Enough to give a sense of where in the trace the error is, without
// dumping thousands of lines into the terminal.
const CONTEXT_LINES = 16

export function checkRollingSolution(output: string, solution: string) {
  const correct = solution.trim()
  const actual = output.trim()

  if (!correct.startsWith(actual)) {
    console.log()
    console.log(chalk.bold(chalk.red("INCORRECT")))
    console.log(chalk.red("Output did not match solution."))
    console.log()

    const correctLines = correct.split("\n")
    const actualLines = actual.split("\n")

    // Find first divergent line index. If all `actualLines` match but
    // `actual` is shorter, divergence is "the next expected line".
    let divergeAt = actualLines.length
    for (let i = 0; i < actualLines.length; i++) {
      if ((correctLines[i] ?? "") !== actualLines[i]) {
        divergeAt = i
        break
      }
    }

    // Single-column green: last CONTEXT_LINES matched lines preceding
    // the divergence. Skips the redundant side-by-side duplication.
    const ctxStart = Math.max(0, divergeAt - CONTEXT_LINES)
    if (ctxStart > 0) {
      console.log(chalk.dim(`… (${ctxStart} matching lines elided)`))
    }
    for (let i = ctxStart; i < divergeAt; i++) {
      console.log(chalk.green(correctLines[i] ?? ""))
    }

    // Side-by-side from the divergent line onward: expected | actual.
    for (let i = divergeAt; i < actualLines.length; i++) {
      const correctLine = (correctLines[i] ?? "").padEnd(60)
      const actualLine = (actualLines[i] ?? "").padEnd(60)
      console.log(`${chalk.green(correctLine)} | ${chalk.red(actualLine)}`)
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
