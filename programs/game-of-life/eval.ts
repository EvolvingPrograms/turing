export type CellValue = 0 | 1
export type Grid = CellValue[][]

/** Parse a grid from its compact USER form: rows of "0"/"1" digits, one row per line. */
export function deformatGrid(input: string): Grid {
  return input
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0 && /^[01]+$/.test(line))
    .map(line => line.split("").map(c => Number(c) as CellValue))
}

/** Compact USER form: one row per line, digits only. */
export function formatGridRaw(grid: Grid): string {
  return grid.map(row => row.join("")).join("\n")
}

const BLOCK = (v: CellValue): string => v === 1 ? "█" : "░"

/**
 * Render a grid as the row-prefixed compact GRID block used by the
 * tape: `{r}: {c}{block} {c}{block} …` per row. This is the single
 * source of truth for the format — both the eval-side ASSISTANT
 * emission (GRID, NEW GRID blocks) and the index-side USER
 * prompt encoding call this so the [USER]/[ASSISTANT] halves stay
 * in lockstep. Drifting apart caused the model to mix formats
 * (e.g. respond in Olivia's `r{r}c{c}` schema after seeing it in
 * a USER prompt).
 */
export function formatGridBlock(grid: Grid): string {
  const R = grid.length
  const C = grid[0].length
  const Wr = String(R - 1).length
  const Wc = String(C - 1).length
  const pr = (r: number): string => String(r).padStart(Wr, "0")
  const pc = (c: number): string => String(c).padStart(Wc, "0")
  // Every cell carries its full `{r},{c}{block}` label — the literal
  // token that STEP cell lines copy from. The row-prefix shortcut
  // (`{r}: …`) broke induction-head literal-copy and triggered the
  // model to fall back to its Olivia-schema prior, so we keep the
  // full-coord form here.
  return grid.map(
    (row, r) => row.map((v, c) => `${pr(r)},${pc(c)}${BLOCK(v)}`).join(" ")
  ).join("\n")
}

/**
 * Pretty-printed cumulative history of grid states (READBACK block).
 * Currently unused but kept as a module-level helper — at long
 * horizons this can be re-enabled as a continuation anchor (the
 * trim-continuation slicer cuts to the last READBACK, giving the
 * model the full prior history of grids in one block).
 *
 * To use: maintain a `Grid[]` history inside the simulator (push a
 * copy of the grid after each step) and call this helper after each
 * NEW GRID block. Cost is O(T²) in tape size because each step
 * prints every prior state, so only enable when the long-horizon
 * continuity is worth more than the size hit.
 */
export function emitGridHistory(
  log: (msg: string) => void,
  history: Grid[],
  throughT: number
) {
  log(`READBACK 0..${throughT}`)
  for (let g = 0; g <= throughT; g++) {
    log(`GEN ${g}`)
    for (const row of history[g]) log(row.map(v => v === 1 ? "█" : "░").join(" "))
  }
}

const NBR_OFFSETS: Array<[string, number, number]> = [
  ["NW", -1, -1], ["N", -1, 0], ["NE", -1, 1],
  [ "W",  0, -1],               [ "E",  0, 1],
  ["SW",  1, -1], ["S",  1, 0], ["SE",  1, 1],
]

/** B3/S23 next-state. */
function nextState(self: CellValue, live: number): CellValue {
  if (self === 1) return (live === 2 || live === 3) ? 1 : 0
  return live === 3 ? 1 : 0
}

/**
 * Conway's Game of Life tape generator — Olivia Helens schema (see
 * oliviahelens/CoGL_automaton share/format-for-lewis.md). The 2D
 * adaptation of induction-head-friendly tape design:
 *
 * - Per step the trace emits both a row-form view (`r0: ░ █ ░ …`)
 *   and an INDEXED token-view (`r0c0░ r0c1█ r0c2░ …`). The row form
 *   is the visual anchor; INDEXED is the literal-copy source for
 *   per-cell neighbor reads.
 * - Per-cell STEP line: `r{r}c{c}{v}: NW=src(t) … =total state+total→new r{r}c{c}{new}`
 *   — cumulative live tally `(t)` after each neighbor, asserts
 *   `=total`, applies LOOKUP (`dead+3→█`), and emits write-back.
 * - Out-of-bounds neighbors are `oob░(t)` (BOUNDARY dead).
 * - End-of-run: `DONE` then `PRINT 0/N … PRINT N/N` single-line
 *   summaries for downstream string-match verification.
 *
 * Stylistic deviations from Olivia retained from our iteration:
 * zero-padded row/col indices when the grid spans 2+ digits, so
 * cell tokens (`r00c00`) and row labels (`r00:`) align visually.
 */
export default function testGameOfLife(
  initialState: string | Grid,
  generations: string | number = 2,
  silent = false
): string {
  if (typeof generations === "string") generations = Number(generations)
  let grid: Grid = typeof initialState === "string" ? deformatGrid(initialState) : initialState

  const R = grid.length
  const C = grid[0].length

  // Zero-padded row/col index helpers — stylistic alignment, no
  // semantic change vs Olivia's single-digit form. Coordinate
  // notation is `R,C` (e.g. `13,4`) — the `r`/`c` letter prefixes
  // from Olivia's form were dropped as visual annotation; the comma
  // is distinctive enough to keep induction-head copies unambiguous.
  const Wr = String(R - 1).length
  const Wc = String(C - 1).length
  const pr = (r: number): string => String(r).padStart(Wr, "0")
  const pc = (c: number): string => String(c).padStart(Wc, "0")
  const coord = (r: number, c: number): string => `${pr(r)},${pc(c)}`

  let output = ""
  const log = (msg: string) => {
    output += msg + "\n"
    if (!silent) console.log(msg)
  }

  if (!silent) {
    console.log(`\n<USER>\nSIZE ${R}x${C}\nSTEPS ${generations}\nGRID 0/${generations}`)
    for (let r = 0; r < R; r++) {
      console.log(grid[r].map((v, c) => `${coord(r, c)}${BLOCK(v)}`).join(" "))
    }
    console.log("</USER>\n<ASSISTANT>")
  }

  // Header + LOOKUP + BOUNDARY (constant across the run).
  log("RULE B3/S23")
  log("LOOKUP")
  log("  live+0→░  live+1→░  live+2→█  live+3→█")
  log("  live+4→░  live+5→░  live+6→░  live+7→░  live+8→░")
  log("  dead+0→░  dead+1→░  dead+2→░  dead+3→█")
  log("  dead+4→░  dead+5→░  dead+6→░  dead+7→░  dead+8→░")
  log("BOUNDARY dead")

  // GRID block — indexed-token view directly. Olivia's schema has a
  // dual (row-form + INDEXED) display; on Opus 4.6 the model treats
  // those as redundant and skips INDEXED when both are present,
  // bailing into prose. We fold them into one block: each row of the
  // GRID is the labeled-token form (`r0c0░ r0c1█ …`), which is the
  // load-bearing view that STEP cell lines copy from. The row-form
  // is dropped — human-readable but skip-bait at scale.
  function emitGrid(label: string, t: number) {
    log(`${label} ${t}/${generations}`)
    for (const line of formatGridBlock(grid).split("\n")) log(line)
  }

  function srcToken(r: number, c: number): string {
    if (r < 0 || r >= R || c < 0 || c >= C) return "oob░"
    return `${coord(r, c)}${BLOCK(grid[r][c])}`
  }

  // Track each generation's grid for the end-of-trace PRINT summary.
  const history: Grid[] = [grid.map(row => row.slice())]

  function step(t: number) {
    log(`STEP ${t}→${t + 1}`)
    const next: Grid = Array.from({ length: R }, () => Array(C).fill(0) as CellValue[])
    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C; c++) {
        const self = grid[r][c]
        let tally = 0
        const parts: string[] = []
        for (const [label, dr, dc] of NBR_OFFSETS) {
          const nr = r + dr
          const nc = c + dc
          // Every slot is labeled with its cardinal. Real-live cells
          // get a `+N` running-count marker (1st live = `+1`, 2nd =
          // `+2`, …) — a compact counter the model finds natural to
          // write, instead of the verbose `prev+1=new` arithmetic
          // that the model kept stripping as decoration.
          //   OOB:       `LABEL=░`
          //   Real dead: `LABEL={r},{c}░`
          //   Real live: `LABEL={r},{c}█ +N`
          if (nr < 0 || nr >= R || nc < 0 || nc >= C) {
            parts.push(`${label}=░`)
          } else if (grid[nr][nc] === 0) {
            parts.push(`${label}=${srcToken(nr, nc)}`)
          } else {
            tally += 1
            parts.push(`${label}=${srcToken(nr, nc)} +${tally}`)
          }
        }
        const total = tally
        const state = self === 1 ? "live" : "dead"
        const newV = nextState(self, total)
        const selfLabel = `${coord(r, c)}${BLOCK(self)}`
        // Line-end `={total}` restored — without it the model
        // miscounted the `dead+N→░` rule phrase by attending to the
        // wrong `|N` token earlier in the line. The explicit
        // `={total}` anchors the rule's total directly adjacent to
        // the rule application, so the model copies a literal
        // neighboring token rather than searching.
        log(`${selfLabel}: ${parts.join(" ")} =${total} ${state}+${total}→${BLOCK(newV)}`)
        next[r][c] = newV
      }
    }
    grid = next
    history.push(grid.map(row => row.slice()))
  }

  // Flow: GRID → STEP → NEW GRID → … → PRINT tail → DONE. PRINT is
  // emitted *before* DONE so the stop sequence terminates the
  // response cleanly after the summary lines. Previously PRINT was
  // after DONE — it never got emitted at inference (stop hits first)
  // and only ate training-tape tokens.
  emitGrid("GRID", 0)
  for (let t = 0; t < generations; t++) {
    step(t)
    emitGrid("NEW GRID", t + 1)
  }
  // PRINT tail temporarily commented out — re-enable if downstream
  // string-match verification is needed. Kept easy to restore.
  // for (let g = 0; g <= generations; g++) {
  //   const flat = history[g].flat().map(BLOCK).join(" ")
  //   log(`PRINT ${g}/${generations} ${flat}`)
  // }
  log("DONE")

  return output.trim()
}
