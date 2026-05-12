# Game of Life

In-context substrate design for Conway's Game of Life (B3/S23) on
production transformers. The program induces a 2D cellular-automaton
simulator from a few-shot training tape, with no fine-tuning and no
external compute — every neighbor count, rule lookup, and write-back
is emitted as a token on the trace.

The schema in this repo is derived from
[Olivia Helens' CGoL tape format][olivia] (Anthropic, May 2026)
with several modifications driven by Opus 4.6's adversarial
compression behavior on dense 2D lookups. We tested Olivia's exact
schema on 4.6 and iterated the format until it ran cleanly at
16×16 / 1-step.

[olivia]: https://github.com/oliviahelens/CoGL_automaton/blob/claude/cgol-attention-test-An6OI/share/format-for-lewis.md

## Result

**16×16 / 1-step completed end-to-end on Opus 4.6** with the current
format. The line shape below is what the model emits; counts, rule
applications, and write-backs are all on the tape.

```
00,02█: NW=░ N=░ NE=░ W=00,01█ +1 E=00,03░ SW=01,01░ S=01,02░ SE=01,03█ +2 =2 live+2→█
```

## Olivia's schema (anchor)

The Anthropic claude-opus-4-7 result: all 4 tested 10×10 patterns
(1 LWSS + 3 random soups at 30/30/40% density) gave 100% strict
cell-accuracy for 2 steps in one shot, no spatial decomposition, the
whole 10×10 grid enumerated in a single tape. Three few-shots —
block 4×4 / 2-step, blinker 5×5 / 2-step, glider 6×6 / 4-step — were
emitted as the training prefix.

Olivia's per-cell line:

```
r0c0░: NW=oob░(0) N=oob░(0) NE=oob░(0) W=oob░(0) E=r0c1░(0) SW=oob░(0) S=r1c0░(0) SE=r1c1░(0) =0 dead+0→░ r0c0░
```

Components, in order:
1. `r{r}c{c}{v}:` — cell label with current value.
2. 8 neighbor reads in NW–SE order: `LABEL=src{v}(t)` where `src` is
   the source coordinate (or `oob` for out-of-bounds), `{v}` is the
   block char (░/█), and `(t)` is the cumulative live-neighbor tally
   up to and including this read.
3. `={total}` — assert total live neighbors.
4. `{state}+{total}→{new}` — apply the B3/S23 LOOKUP table.
5. `r{r}c{c}{new}` — write-back: the cell's new value.

Surrounded by:

- `RULE B3/S23` + `LOOKUP` (16-entry table) + `BOUNDARY dead` header.
- `GRID t/N` row-form view (`r0: ░ ░ ░ ░ ░`).
- `INDEXED` token-form view (`r0c0░ r0c1░ ...`).
- `STEP t→t+1` per-cell lines (above).
- `NEW GRID t+1/N` row-form view of the result.
- `DONE` stop sequence.
- `PRINT 0/N` ... `PRINT N/N` row-major flattened summary lines.

The key induction-head-friendly piece is the `NW=r2c2█` binding:
each neighbor's value-block follows a source coordinate that the
model must copy verbatim from the INDEXED block. This is the load-
bearing pattern — Olivia's caveat #4 reports that v1 of her schema,
without the source-coord binding, failed at 6×6 toad with one
fabricated `NW░` value, propagating through the neighborhood.

## What we kept from Olivia

- **Source-coord binding on every neighbor read.** The `LABEL={src}{v}`
  form is the induction-head copy primitive; we never touched it.
- **The 3-shot anchor structure** (block / blinker / glider at
  progressively larger sizes) — though we replaced the canonical
  glider with non-iconic patterns (see below).
- **`RULE B3/S23` and `BOUNDARY dead` headers** as constants.
- **`STEP t→t+1` per-cell line**, NW–SE neighbor order, `=total
  state+total→new` line end.
- **`GRID t/N` and `NEW GRID t+1/N`** as the indexed-token state
  representation between steps.

## What we changed (and why)

Each change below was driven by an empirical failure on Opus 4.6.
The model adversarially compresses tokens it considers decoration;
each iteration is a discovery of which tokens *cannot* be dropped
on 4.6 without losing accuracy, and which the model strips anyway.

### Coordinate notation: `r{r}c{c}` → `{r},{c}`

Olivia writes `r0c0█`; we write `00,00█`. The `r`/`c` letter prefixes
were visual annotation for humans; the model's induction head copies
either form equally well. Stripping them saves 2 chars per coord, and
zero-padding (`00,00` not `0,0` at scale) keeps cell tokens at constant
width so column-counting in the GRID block stays uniform.

The leading `r0c0` form *does* leak from the model's prior — when
our USER prompt accidentally still emitted the `r0c0` form (a leftover
in `encode()`), the model immediately responded in Olivia's exact
schema rather than our compressed one. Format consistency between
[USER] and [ASSISTANT] halves of the tape is load-bearing.

### Dual grid view (row-form + INDEXED) → indexed tokens only

Olivia emits both:

```
GRID 0/2
r0: ░ █ █ █ ░
...
INDEXED
r0c0░ r0c1█ r0c2█ r0c3█ r0c4░
...
```

On 4.6, the dual view is unstable — the model treats the second
block as redundant and skips it, bailing into prose or jumping to
STEP. We fold them into one block: each row of the GRID block is
the labeled-token form (`00,00░ 00,01█ ...`). One representation,
no skip-bait.

### OOB neighbors: `oob░(t)` → `LABEL=░`

Olivia's OOB form is `NW=oob░(0)`. On 4.6 the model consistently
refuses to emit the running tally `(t)` on OOB entries (it correctly
observes OOB always contributes 0 and treats the parens as
decoration). We codified the model's preference: OOB slots are
`LABEL=░`, no coord, no tally. Position in the 8-token sequence
implies the cardinal.

### `(t)` tally → `+N` running count on live cells

Olivia's running tally is parenthesized after every neighbor:
`NW=r0c0█(1) N=r0c1░(1) NE=r0c2█(2) …`. On 4.6 the model:
- Drops `(t)` on OOB entries (correctly — OOB adds 0).
- Drops `(t)` on dead in-grid entries (no information change).
- *Slips the +1 increment* between adjacent live entries even when
  the tally is emitted — confirmed twice by miscounts (model wrote
  `=3` when listed live neighbors summed to 4).

We tried several mitigations: explicit `prev+1=new` per live read
(works, but the model strips it as decoration when the line is
heavily anchored elsewhere); pipe-separated tally `LABEL=src|N`
(model still slips internal +1 between entries). What finally
stuck: a `+N` ordinal counter on live entries only — "this is the
Nth live neighbor seen." Compact, structurally distinct, and aligned
with how the model naturally describes a count.

```
S=01,00█ +1 SE=01,01█ +2  ← S is the 1st live, SE the 2nd
```

### LOOKUP table: removed

Olivia includes the 16-entry B3/S23 LOOKUP table at trace start:

```
LOOKUP
  live+0→░  live+1→░  live+2→█  live+3→█
  ...
```

On 4.6, the LOOKUP table feeds the model template tokens (`live+3→█`,
`dead+0→░`) that invite **categorical** output strategies on dense
random grids — the model writes things like "Cells with 0 live
neighbors (dead+0→░): none" instead of the per-cell trace. B3/S23 is
in the model's prior and the per-cell `dead+N→█` rule phrase applies
the rule explicitly per line; LOOKUP is redundant *and* adversarially
attractive. Removed.

### Write-back token: removed

Olivia's line ends `… dead+0→░ r0c0░` — the trailing `r0c0░` is the
write-back, restating the cell's new value. The `→░` arrow already
commits the new value, and the model consistently refuses to emit
the writeback regardless of training reinforcement. Removed.

### PRINT tail: moved (and currently commented out)

Olivia's PRINT lines came *after* `DONE`. With `DONE` as the stop
sequence, the model halts at `DONE` and never emits PRINT — making
those lines pure training-tape waste. We moved PRINT *before* `DONE`
when needed, then commented it out entirely since downstream string-
match verification is sufficient with the indexed-token GRID blocks.

### Training shots: no glider

Olivia's canonical glider in the top-left corner is so iconic that
4.6 bails into natural-language commentary ("This is a glider
pattern. Let me compute each…") rather than computing. We removed
all glider patterns from training shots and replaced with non-iconic
noisy patterns at sizes 3×3 through 16×16. The glider stays as a
test pattern only.

### Multiple small noisy shots at long horizons

Olivia's 3-shot prefix is at small sizes (4×4 / 5×5 / 6×6) with
short horizons (2 / 2 / 4 steps). We add several noisy small shots
and at-scale OOD anchors (10×10, 12×12, 14×14, 16×16 at 2 steps)
to keep the format anchored at the production grid sizes — without
at-scale shots the model compresses harder on larger test inputs.

### Continuation: trim slicing at `NEW GRID`

For runs that overflow the output token budget, we use the
trim-continuation primitive from the rest of this repo (see the
v2 paper outline §2.3). The continuation anchor is the most recent
`NEW GRID t/N` block — the indexed-token view that the next STEP
reads from. The slicer cuts at this boundary so the model resumes
with the just-computed state in scope.

## Substrate-design principles applied

This program is also a worked example of the substrate-design
patterns documented in the repo's `ideas.md`:

- **Deterministic single-direction trace** — every line is a
  function of tokens to its immediate left.
- **Externalized counters** — the `+N` running count and the
  `=total` line-end commit externalize the live-neighbor count
  rather than asking the model to maintain it internally.
- **Memoization (trust the circuits)** — we drop the explicit
  +0 arithmetic on dead reads; circuits track unchanged state
  reliably without the externalized op.
- **Induction-head scaffold** — every `LABEL=src` token is a
  literal copy from the GRID block above, the most reliable
  retrieval primitive transformers do.
- **Substrate design avoids branching** — every cell line has the
  same 8-slot shape regardless of cell position. OOB and real-dead
  slots both have the `LABEL=...` form so the model's emit strategy
  is uniform.
- **Explicit end-of-program marker** — `DONE` + stop sequence
  prevents end-of-trace prose drift.

## Running

```
bun programs/game-of-life [model-slug] [--flags]
```

Flags:
- `--size=N` — square grid side (default 10)
- `--steps=N` — generations per test (default 2)
- `--n=K` — number of test instances (default 1)
- `--density=F` — live-cell fraction for random tapes (default 0.35)
- `--pattern=glider|blinker|block` — deterministic seed instead of
  random
- `--orient=se|sw|ne|nw` — glider orientation (default `nw`)
- `--at=r,c` — pattern placement offset
- `--debug` — write `train.txt` and `tests.jsonl` to the program dir

Example:

```
bun programs/game-of-life anthropic/claude-opus-4.6 --size=10 --steps=2 --n=3
```

## Acknowledgement

The schema design is downstream of Olivia Helens' published CGoL
tape ([repo][olivia-repo], May 2026). The induction-head-friendly
source-coord binding (`NW=r2c2█`) is the load-bearing piece we kept
intact. Modifications above are model-specific (Opus 4.6 vs the
4.7 Olivia tested on) and don't fault her schema — they're
empirical findings about where 4.6's compression behavior diverges
from 4.7's.

[olivia-repo]: https://github.com/oliviahelens/CoGL_automaton
