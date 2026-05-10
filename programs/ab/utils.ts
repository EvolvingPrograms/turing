import { tokens, AH, HA, BH, HB, type Value } from "./tokens"

export function reduce(xs: Value[]): [Value[], number] {
  const ys: Value[] = []
  let rwts = 0
  for (let i = 0; i < xs.length; i++) {
    if (xs[i] === AH && xs[i + 1] === HB) {
      ys.push(HB, AH)
      i++
      rwts++
    } else if (xs[i] === BH && xs[i + 1] === HA) {
      ys.push(HA, BH)
      i++
      rwts++
    } else if (xs[i] === AH && xs[i + 1] === HA) {
      i++
      rwts++
    } else if (xs[i] === BH && xs[i + 1] === HB) {
      i++
      rwts++
    } else {
      ys.push(xs[i])
    }
  }
  return [ys, rwts]
}

export function normal(xs: Value[]): [Value[], number] {
  let rwts = 0
  let term = xs
  let work: number
  while (true) {
    [term, work] = reduce(term)
    if (work > 0) {
      rwts += work
    } else {
      break
    }
  }
  return [term, rwts]
}

export function randomTerm(): Value[] {
  const result: Value[] = []
  for (let i = 0; i < 12; i++) {
    result.push(tokens[Math.floor(Math.random() * tokens.length)])
  }
  return result
}

export function show(xs: string[]): string {
  return xs
    .map((x) => {
      switch (x) {
        case HA:
          return "#A "
        case HB:
          return "#B "
        case AH:
          return "A# "
        case BH:
          return "B# "
        default:
          return ""
      }
    })
    .join("")
}