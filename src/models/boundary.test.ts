import { test, expect } from "bun:test"
import { sliceContinuationPrefill } from "./model"

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

test("boundary regex with no match → falls back to full trace", () => {
  // When the boundary is defined but hasn't matched yet (still
  // streaming the first STEP/segment), the slicer must return the
  // full trace so the model keeps the header (and prior chunks) in
  // scope. Returning just `completed` here strips the header from
  // chunk 2+ and the model bails to a fresh response.
  const fullTrace = "RULE B3/S23\nrow0\nrow1\nrow2\nrow3\n"
  const completed = "row3\n"
  const result = sliceContinuationPrefill(fullTrace, completed, /^tick=/m)
  expect(result).toBe(fullTrace)
})

test("global flag on caller regex is preserved without duplication", () => {
  // Passing /^tick=/gm should not throw (we don't double-add `g`).
  const fullTrace = "tick=0\nx\ntick=1\ny\n"
  const completed = "tick=1\ny\n"
  const result = sliceContinuationPrefill(fullTrace, completed, /^tick=/gm)
  expect(result.startsWith("tick=1")).toBe(true)
})

test("continueAnchor backs up when latest boundary's step is in-progress", () => {
  // Latest FIRE started but END_REFRESH hasn't appeared yet → slicer
  // backs up to the previous FIRE whose REFRESH completed.
  const fullTrace =
    "FIRE k=0\nREFRESH\nA0\nB0\nEND_REFRESH\nrowwork\nO0\n" +
    "FIRE k=8\nREFRESH\nA0\nB0\nEND_REFRESH\nrowwork\nO8\n" +
    "FIRE k=16\nREFRESH\nA0\nB0\n"
  const completed = "FIRE k=16\nREFRESH\nA0\nB0\n"
  const result = sliceContinuationPrefill(
    fullTrace,
    completed,
    /^FIRE k=\d+/m,
    "END_REFRESH"
  )
  expect(result.startsWith("FIRE k=8")).toBe(true)
  expect(result.includes("FIRE k=16")).toBe(true)
  expect(result.includes("FIRE k=0")).toBe(false)
})

test("continueAnchor accepts the latest boundary when its step completed", () => {
  // Latest FIRE has END_REFRESH after it → slice from latest FIRE.
  const fullTrace =
    "FIRE k=0\nREFRESH\nA0\nEND_REFRESH\nO0\n" +
    "FIRE k=8\nREFRESH\nA0\nEND_REFRESH\nrowwork\n"
  const completed = "FIRE k=8\nREFRESH\nA0\nEND_REFRESH\nrowwork\n"
  const result = sliceContinuationPrefill(
    fullTrace,
    completed,
    /^FIRE k=\d+/m,
    "END_REFRESH"
  )
  expect(result.startsWith("FIRE k=8")).toBe(true)
  expect(result.includes("FIRE k=0")).toBe(false)
})

test("prelude defaults to everything before first boundary match", () => {
  // With no continuePrelude regex, the slicer falls back to using
  // the first boundary match as the prelude end. Multi-match case:
  // prelude = before first FIRE; slice = from last FIRE.
  const fullTrace =
    "CHUNK=2\n" +
    "T0=...\n" +
    "FIRE k=0\nREFRESH\nA\nEND_REFRESH\nO0\n" +
    "FIRE k=8\nREFRESH\nA\nEND_REFRESH\nrowwork\n"
  const completed = "FIRE k=8\nREFRESH\nA\nEND_REFRESH\nrowwork\n"
  const result = sliceContinuationPrefill(
    fullTrace,
    completed,
    /^FIRE k=\d+/m,
    "END_REFRESH"
  )
  expect(result.startsWith("CHUNK=2\nT0=...\n<HISTORY_TRUNCATED>\nFIRE k=8")).toBe(true)
  expect(result.endsWith("rowwork\n")).toBe(true)
  // FIRE k=0's content (everything between first and last match) is
  // the truncated middle.
  expect(result.includes("FIRE k=0")).toBe(false)
})

test("start/end pair: header ends at the earlier of first-start or first-end", () => {
  // GoL: start=NEW GRID, end=STEP. The first STEP appears *before*
  // the first NEW GRID, so prelude end = first STEP position. The
  // prelude is everything before STEP 0→1 (header + initial grid).
  // The slice is from the most recent qualifying NEW GRID.
  const fullTrace =
    "RULE B3/S23\n" +
    "LOOKUP\n" +
    "BOUNDARY dead\n" +
    "GRID 0/2\n" +
    "00,00░ 00,01░\n" +
    "STEP 0→1\n" +
    "00,00░: ░ ░ ░ ░ ░ ░ ░ ░ =0 dead+0→░\n" +
    "NEW GRID 1/2\n" +
    "00,00░ 00,01░\n" +
    "STEP 1→2\n" +
    "00,00░: ░ ░ ░"
  const completed = "STEP 1→2\n00,00░: ░ ░ ░\n"
  const result = sliceContinuationPrefill(
    fullTrace,
    completed,
    /^NEW GRID \d+\/\d+$/m,
    "STEP "
  )
  expect(result.startsWith("RULE B3/S23\nLOOKUP\nBOUNDARY dead\nGRID 0/2\n00,00░ 00,01░\n<HISTORY_TRUNCATED>\nNEW GRID 1/2")).toBe(true)
  // STEP 0→1's cells were in the truncated middle.
  expect(result.includes("=0 dead+0→░")).toBe(false)
})

test("fewer complete steps than continueWindow → return full trace", () => {
  // Only 1 qualifying NEW GRID exists but window=2 — the slicer
  // can't honor the request, so it returns the full trace instead
  // of trimming with what's available.
  const fullTrace =
    "header\n" +
    "STEP 0→1\nA\nB\n" +
    "NEW GRID 1/3\n" +
    "STEP 1→2\nC\n"
  const completed = "STEP 1→2\nC\n"
  const result = sliceContinuationPrefill(
    fullTrace,
    completed,
    /^NEW GRID \d+\/\d+$/m,
    "STEP ",
    2
  )
  expect(result).toBe(fullTrace)
})

test("no qualifying start (no NEW GRID yet) → return full trace", () => {
  const fullTrace =
    "RULE B3/S23\n" +
    "GRID 0/2\n" +
    "STEP 0→1\n" +
    "00,00░: ░ ░ ░ ░\n"
  const completed = "STEP 0→1\n00,00░: ░ ░ ░ ░\n"
  const result = sliceContinuationPrefill(
    fullTrace,
    completed,
    /^NEW GRID \d+\/\d+$/m,
    "STEP "
  )
  expect(result).toBe(fullTrace)
})

test("continueWindow > 1 includes additional complete steps", () => {
  // Cross-slide-style: start before end. With N=2, the slice starts
  // at the *second-to-last* qualifying start so the prefill carries
  // a full previous step as pattern reference.
  const fullTrace =
    "header\n" +
    "RESUME k=0\nrefresh\nEND_REFRESH\nA\n" +
    "RESUME k=1\nrefresh\nEND_REFRESH\nB\n" +
    "RESUME k=2\nrefresh\nEND_REFRESH\nC\n"
  const completed = "RESUME k=2\nrefresh\nEND_REFRESH\nC\n"
  const result = sliceContinuationPrefill(
    fullTrace,
    completed,
    /^RESUME k=\d+/m,
    "END_REFRESH",
    2  // include last 2 complete steps
  )
  // Slice starts at RESUME k=1 (one back from k=2). Prelude is
  // before first start (header\n) — first start comes before first
  // end here, so prelude end = first RESUME position.
  expect(result.startsWith("header\n<HISTORY_TRUNCATED>\nRESUME k=1")).toBe(true)
  // k=0's body is truncated.
  expect(result.includes("\nA\n")).toBe(false)
  // k=1 and k=2 both present.
  expect(result.includes("RESUME k=1")).toBe(true)
  expect(result.includes("RESUME k=2")).toBe(true)
})

test("continueAnchor falls back to completed when no boundary qualifies", () => {
  // First FIRE in trace, REFRESH not yet finished → no qualifying
  // boundary. Falls back to `completed`.
  const fullTrace = "FIRE k=0\nREFRESH\nA0\n"
  const completed = "FIRE k=0\nREFRESH\nA0\n"
  const result = sliceContinuationPrefill(
    fullTrace,
    completed,
    /^FIRE k=\d+/m,
    "END_REFRESH"
  )
  expect(result).toBe(completed)
})

