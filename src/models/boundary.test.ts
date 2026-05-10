import { test, expect } from "bun:test"
import { sliceContinuationPrefill } from "./anthropic"

// Unit tests for the continuation-prefill slicer. The slicer decides what
// assistant text the API sees as the prefill when a response overflows
// and we need to issue a CONTINUE. Without a boundary, it returns the
// just-completed chunk (original behavior). With a boundary, it returns
// the suffix of the full trace starting at the last boundary match — so
// a cut landing mid-step still resumes with the full step in context.

test("no boundary → returns the completed chunk verbatim", () => {
  const fullTrace = "k=0\nA*B=1\nO0 c0\nk=1\nA*B=2\n"
  const completed = "k=1\nA*B=2\n"
  expect(sliceContinuationPrefill(fullTrace, completed, undefined)).toBe(completed)
})

test("boundary present → slices fullTrace from last match", () => {
  const fullTrace = [
    "tick=0 [FIRE]",
    "k=0",
    "A*B=1 sum=1",
    "O0 c0",
    "tick=1 [SKIP]",
    "k=1",
    "A*B=2 sum=2",
    "",
  ].join("\n")
  const completed = "tick=1 [SKIP]\nk=1\nA*B=2 sum=2\n"
  const result = sliceContinuationPrefill(fullTrace, completed, /^tick=/m)
  // Starts at the LAST tick= line, includes the in-flight step.
  expect(result.startsWith("tick=1 [SKIP]")).toBe(true)
  expect(result.endsWith("sum=2\n")).toBe(true)
  // Earlier tick=0 step is NOT in the prefill (already in cached prefix).
  expect(result.includes("tick=0")).toBe(false)
})

test("boundary present, cut mid-step → prefill spans previous chunk", () => {
  // The cut happens in the middle of the k=1 step. The new chunk
  // (`completed`) starts mid-step with no `tick=` line. The slicer must
  // walk back into the previous chunk to find the last boundary.
  const fullTrace =
    "tick=0 [FIRE]\nk=0\nO0 c0\n" +    // older committed chunk
    "tick=1 [SKIP]\nk=1\nA0*B0=1\n" + // chunk that started k=1
    "A1*B0=2\nA2*B0=3\n"               // new chunk: mid-step, no tick=
  const completed = "A1*B0=2\nA2*B0=3\n"
  const result = sliceContinuationPrefill(fullTrace, completed, /^tick=/m)
  expect(result.startsWith("tick=1 [SKIP]")).toBe(true)
  expect(result.includes("k=1")).toBe(true)
  expect(result.includes("A0*B0=1")).toBe(true)
  expect(result.includes("A2*B0=3")).toBe(true)
  // Pre-k=1 history is not part of the prefill — it's in the cached
  // assistant prefix (or, in the current impl, simply not re-sent).
  expect(result.includes("tick=0")).toBe(false)
})

test("boundary regex without /m still matches at line start via source", () => {
  // We add `g` automatically; the caller-supplied flags are otherwise
  // preserved. Verify a regex written with `m` works end-to-end.
  const fullTrace = "tick=0\nfoo\ntick=1\nbar\n"
  const completed = "tick=1\nbar\n"
  const result = sliceContinuationPrefill(fullTrace, completed, /^tick=/m)
  expect(result).toBe("tick=1\nbar\n")
})

test("boundary regex with no match → falls back to completed chunk", () => {
  const fullTrace = "no boundary in here\nstill nothing\n"
  const completed = "still nothing\n"
  const result = sliceContinuationPrefill(fullTrace, completed, /^tick=/m)
  expect(result).toBe(completed)
})

test("global flag on caller regex is preserved without duplication", () => {
  // Passing /^tick=/gm should not throw (we don't double-add `g`).
  const fullTrace = "tick=0\nx\ntick=1\ny\n"
  const completed = "tick=1\ny\n"
  const result = sliceContinuationPrefill(fullTrace, completed, /^tick=/gm)
  expect(result.startsWith("tick=1")).toBe(true)
})

