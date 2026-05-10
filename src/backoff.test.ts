import { describe, expect, test, spyOn, mock } from "bun:test"
import { backoff } from "./backoff"

describe("backoff", () => {
  test("success on first try returns value immediately", async () => {
    const action = mock(() => Promise.resolve(42))
    const result = await backoff(action, 6, 0)
    expect(result).toBe(42)
    expect(action).toHaveBeenCalledTimes(1)
  })

  test("success after some failures returns final value", async () => {
    let calls = 0
    const action = mock(() => {
      calls++
      if (calls < 3) throw new Error("transient")
      return Promise.resolve("ok")
    })
    spyOn(console, "error").mockImplementation(() => {})
    const result = await backoff(action, 6, 0)
    expect(result).toBe("ok")
    expect(action).toHaveBeenCalledTimes(3)
  })

  test("throws after maxRetries exceeded with correct message", async () => {
    // With maxRetries=2: retries increments to 1 (<=2, retry), 2 (<=2, retry), 3 (>2, throw)
    // So action is called 3 times total (initial + 2 retries)
    const action = mock(() => { throw new Error("always fails") })
    spyOn(console, "error").mockImplementation(() => {})
    await expect(backoff(action, 2, 0)).rejects.toThrow("Max retries exceeded.")
    expect(action).toHaveBeenCalledTimes(3)
  })

  test("exponential backoff doubles delay each retry", async () => {
    const delays: number[] = []
    const origSetTimeout = globalThis.setTimeout
    // @ts-ignore
    globalThis.setTimeout = (fn: () => void, ms: number) => {
      delays.push(ms)
      return origSetTimeout(fn, 0)
    }

    let calls = 0
    const action = mock(() => {
      calls++
      if (calls <= 3) throw new Error("fail")
      return Promise.resolve("done")
    })
    spyOn(console, "error").mockImplementation(() => {})

    try {
      await backoff(action, 6, 5)
    } finally {
      globalThis.setTimeout = origSetTimeout
    }

    // initialDelay=5s → 5000ms, then 10000ms, then 20000ms
    expect(delays).toEqual([5000, 10000, 20000])
  })

  test("custom initialDelay=0 runs fast with multiple retries", async () => {
    let calls = 0
    const action = mock(() => {
      calls++
      if (calls < 4) throw new Error("transient")
      return Promise.resolve("fast")
    })
    spyOn(console, "error").mockImplementation(() => {})

    const start = Date.now()
    const result = await backoff(action, 6, 0)
    const elapsed = Date.now() - start

    expect(result).toBe("fast")
    expect(elapsed).toBeLessThan(500)
    expect(action).toHaveBeenCalledTimes(4)
  })
})
