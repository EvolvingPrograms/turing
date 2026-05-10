import { describe, expect, test, afterEach, spyOn } from "bun:test"

import { tqdm } from "./progress"

describe("tqdm", () => {
  let writeSpy: ReturnType<typeof spyOn>

  afterEach(() => {
    writeSpy?.mockRestore()
  })

  test("yields each input element in order", () => {
    writeSpy = spyOn(process.stdout, "write").mockImplementation(() => true)
    expect(Array.from(tqdm([1, 2, 3]))).toEqual([1, 2, 3])
  })

  test("empty iterable returns empty array without throwing", () => {
    writeSpy = spyOn(process.stdout, "write").mockImplementation(() => true)
    expect(() => Array.from(tqdm([]))).not.toThrow()
    expect(Array.from(tqdm([]))).toEqual([])
  })

  test("works with non-array iterables (generator)", () => {
    writeSpy = spyOn(process.stdout, "write").mockImplementation(() => true)
    const gen = (function* () {
      yield "a"
      yield "b"
    })()
    expect(Array.from(tqdm(gen))).toEqual(["a", "b"])
  })

  test("writes to stdout at least N times and final call ends with newline", () => {
    const calls: string[] = []
    writeSpy = spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      calls.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk))
      return true
    })

    Array.from(tqdm([10, 20, 30]))

    expect(calls.length).toBeGreaterThanOrEqual(3)
    expect(calls[calls.length - 1]).toBe("\n")
  })

  test("final progress line contains 100.00%", () => {
    const calls: string[] = []
    writeSpy = spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      calls.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk))
      return true
    })

    Array.from(tqdm(["x", "y"]))

    // The progress line written after the last item (second-to-last call; last is "\n")
    const progressLine = calls[calls.length - 2]
    expect(progressLine).toContain("100.00%")
  })
})
