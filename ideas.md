# Ideas & Results

Short reference of the big ideas, results, and metrics from this work.
Aim: survive context loss. Keep it terse.

## Framing

**No human language anywhere.** Every program in this repo is induced from
structured examples alone — opcodes, position labels, equations. No prose,
no English description of what the algorithm does or how it works. The
model learns the program *as a distribution to predict*, not as an
instruction it's told to follow. The opcodes (`START`, `REFRESH`,
`END_REFRESH`, `k=N step=M`, `BASE`, `CALL`, `RETURN`, etc.) are
single-token control words, never English sentences.

This is the core empirical claim — the model is a **distribution machine**
that learns to simulate a program exactly by predicting the distribution
of valid traces it has been shown. Algorithmic generalization without
natural-language teaching. The 2024 paper's central finding generalizes:
Trachtenberg cross-multiplication, Karatsuba recursion, and memoized
base-N cells are all learnable by example-pattern alone.

**Deterministic single-direction traces.** Every line in our format has
exactly one valid next-state given the line above. Opcodes disambiguate
transitions (e.g., `END_REFRESH` → `k=N` always; `O<k>_<v> c<v>` →
`REFRESH` or `k=N+1`). No branching, no ambiguous parser states. This
turns "the model has to figure out what to emit" into "the model has to
copy/predict the next deterministic line." Far more reliable.

**The tape is the register file.** The model has *no internal state
between tokens*. Every value the computation needs — counters, partial
sums, cell contents, cycle positions, anything — must be **written to
the tape** so it can be **read back via attention** later. Each emitted
token becomes a register that subsequent generation steps can address.
"Hidden" counters don't exist on this substrate: there is no scratchpad
beyond the tape itself.

This is the LLM-as-computer architecture in one line: *the tape is the
register file, generation is the ALU, attention is the bus*. Algorithms
must be designed around this. State that isn't externalized into the
tape is state the model does not have. The 2024 Turing-completeness
result essentially says: this register file is unbounded (within the
context window), and that's sufficient for universal computation.

Concrete corollary: when we want a counter (e.g. refresh cycle 0..7), it
must appear as an explicit value in each iteration's tape line, not
inferred. The model reads `tick=5 [SKIP]` from the prior line, increments
to 6, and emits `tick=6 [SKIP]`. The increment is local — attention only
needs to reach back one line. That's the regime where the substrate is
reliable.

**Computation is interruptible because the tape is the state.** All
intermediate state is externalized as visible tokens. When a generation
hits the per-call token limit, we (a) cache-mark the partial response,
(b) start a new call with the prior trace re-fed as cached prefix +
"CONTINUE" prompt. The model picks up reading its own prior output —
which is the same context it would have had if the call had continued
unbroken. The computation can carry across an arbitrary number of calls
because no state is lost at the boundary. This is the practical
instantiation of Turing-machine semantics: the tape *is* the program
counter, the registers, the stack — all in one. Halt and resume is free.

**The refresh interval K is a substrate-coverage parameter.** Choosing K
is choosing what fraction of the trace tokens are dedicated to
attention-maintenance state rather than computation:

- K=∞ (no refresh): zero overhead, but attention must reach back to the
  original tape declaration — distance grows linearly with trace length,
  failures grow accordingly.
- K=1 (refresh every iter): ~50% of trace is maintenance, but every cell
  is freshly visible within ~1 iteration of any use. Always within attention
  horizon, never drifts.
- K=8 (our choice): ~12.5% of trace is maintenance. Every cell is
  refreshed every ~8 iterations. Roughly matches the model's effective
  attention horizon at our densities.

The right K is roughly *"the iteration distance at which model attention
becomes unreliable for cell-value retrieval"*. Smaller K wastes tokens
on unnecessary maintenance; larger K starves the model of fresh references.
This is a measurable substrate parameter — at different model scales,
different attention-head architectures, different context fillings, K
would differ. The classical algorithm literature has no analog for this
parameter because it doesn't apply to the RAM model.

**The LLM is a computational substrate with its own complexity theory.**
The RAM model (O(1) arithmetic, O(1) memory access, bottleneck = operation
count) does not apply. On an autoregressive transformer:

- Each "operation" decomposes into many output tokens, each carrying
  independent error probability. Cost is per-token, not per-op.
- Memory access (attention to prior context) degrades with distance.
  There's an effective attention horizon, ~500 reliable tokens.
- The binding constraint is **attention-stable state across long
  contexts**, not arithmetic operation count.

The right algorithmic question is: *given an attention horizon H, what's
the minimum-cost decomposition such that no operation references state
more than H tokens back?* This is **cache-oblivious algorithm design on
an autoregressive substrate**. Different from the classical
cache-oblivious literature (which optimizes spatial locality on
conventional memory hierarchies).

**Meta-computation is real.** Operations whose purpose is to maintain
substrate state (REFRESH, anchor reprints) are first-class computational
steps — not overhead — because the substrate has implicit state we must
explicitly manage.

## Format compressions (compose multiplicatively)

Each step independently safe; gains compound.

1. **Bit → nibble (chunk=4 bits)**: 16× fewer products at same operand size.
2. **Schoolbook → cross-multiplication**: convolution shape, denser
   per-token, single accumulator per output position.
3. **Pair-grouping**: two products per line, uniform line shape kills
   the alternate-line-types attention trap.
4. **LSB-first encoded input**: position labels match between [USER] and
   tape, no mental reversal during copy.
5. **Chunked tape (4 cells/line)**: avoids 16+ cell single-line drift.
6. **Cell-aligned encoding**: [USER] cells match tape cells 1:1 — no
   re-grouping required during transcription.
7. **Base-N cells (chunk=2 → base-100)**: memorize small multiplications
   in the model's prior. 4× fewer products. Per-cell mental product
   ≤ 99×99=9801 is reliable.
8. **REFRESH every k-block**: meta-computation that maintains attention
   coherence. Roughly doubles trace size but eliminates the deep-trace
   attention-drift failure class.

## Algorithms tried

- `arithmetic-tape` (2024 paper): bit-level binary multiplication.
- `arithmetic-2026`: nibble-level binary (4-bit chunks).
- `arithmetic-2026-cross`: decimal cross-multiplication (Urdhva-Tiryak /
  Trachtenberg general method).
- `arithmetic-2026-karatsuba`: decimal Karatsuba with configurable base
  case threshold (2-digit base default).
- `arithmetic-2026-cross-memo`: decimal cross with chunk=N memoization.
  CLI flag `--chunk=N`. Default chunk=2.

## Results (Claude Opus 4.6, temperature 0)

All 100% pass unless noted.

| Algorithm | Operands | Out tokens | Calls | Cost |
|---|---|---|---|---|
| 2024 paper (arithmetic-tape) | 27-bit × 27-bit (~9 dec digits) | ~16,400 | 5 | n/a |
| arithmetic-2026 nibble | 32-bit × 32-bit (~10 dec each) | 4,386 | 2 | $0.21 |
| cross | 16-dig × 16-dig dec | 4,756 | 2 | $0.186 |
| Karatsuba | 16-dig × 16-dig | 4,758 | 1 | $0.152 |
| cross-memo chunk=2 | 16-dig × 16-dig | 1,530 | 1 | $0.050 |
| cross-memo chunk=2 | 32-dig × 32-dig | 5,160 | 2 | $0.182 |
| cross-memo chunk=2 | 64-dig × 64-dig | 18,980 | 5 | $0.622 |
| cross-memo chunk=2 + refresh-every-k | 128-dig × 128-dig | (running) | ~16-30 | ~$4-8 est. |

Cost per output digit at scale stabilizes around **$0.0016-0.0049/digit**
on cross-memo chunk=2. Lowest measured: chunk=2 at 16-dig = $0.0016/digit.

## Failure modes observed (and fixes)

- **Long monotonous tape copies** (16+ cells single-line): drift in
  middle. Fix: 4-cell-per-line chunking.
- **Mental reversal** (input MSB-first vs tape LSB-first): drift on long
  copies. Fix: LSB-first encoded input.
- **Alternating line types** (multiply / sum lines): drift past ~8
  products. Fix: pair-grouping, uniform line shape.
- **Inline base case vs CALL conflation** (Karatsuba): model couldn't
  distinguish syntactically. Fix: explicit `BASE` opcode prefix.
- **Tape copy errors deep in trace**: model misreads single cell after
  hundreds of lines. Fix: REFRESH every k-block.
- **Per-cell mental arithmetic** at chunk=3 (3-digit × 3-digit):
  occasional ~1% slip × many products = cumulative drift. At chunk=2
  reliable.
- **Counting to N over long traces**: model can't track "refresh every 16
  iterations." Fix: refresh on every iteration (no counting needed) +
  syntactically distinct REFRESH opcode.

## Literature anchors

- Dziri et al. (NeurIPS 2024): GPT-4 ~1% on 4-digit × 4-digit decimal.
- Ball et al. (2024): GPT-4 at 1.0% on 4×4 decimal.
- Wan et al. (2024): specialized fine-tuned arithmetic transformer at
  99.9% on 5-digit × 5-digit.
- Stolfo et al. (2024): research frontier on 5×5 decimal with conditioning.
- Our 2024 result (the paper): 9-digit equivalent (27-bit binary), 100%.
- **This session: 64-128 digit decimal multiplication at 100% on
  Claude 4.6, general-purpose, no fine-tuning, ~$0.50-$5/test.**

The gap to the published literature in absolute operand size is roughly
**13-26× linear, or ~10^58-10^250 in product magnitude**.

## 128 × 128 milestone (2026-05-11, cross-slide)

Two 128-digit operands successfully multiplied to a 256-digit product,
single run, claude-opus-4.6, trim-mode continuation. Product magnitude
~2.2 × 10²⁵⁵.

This is the first time we hit 128 operand digits cleanly. Previous
sessions topped out at 64 operand digits (128-digit product). 128
operand digits → 256-digit product is ~10⁷⁵× larger than the prior
best.

### What it took — failure-mode cascade

Each of the following was a debugged-and-fixed failure mode along the
way. They're not redundant; each one is a load-bearing piece of the
shape that holds at this scale.

| # | Failure | Fix |
|---|---|---|
| 1 | `pairs +1` increment slip at FIRE boundary | replaced `pairs=N` with copy-friendly `iLast` in RESUME |
| 2 | `b.i` vs `a.i` parity ambiguity at row-end | one pair per line, label is the pair's own `i` |
| 3 | `k % 16` FIRE/SKIP slip at deep k | externalized `tick=N/16` (then 12) cycle counter |
| 4 | `START` / `CHUNK=` re-emission on resume | trace prelude + `<HISTORY_TRUNCATED>` marker in trim slice |
| 5 | OUT delta vs cumulative at deeper FIREs | range header `OUT O0..O<n-1>` + 48-digit training example |
| 6 | 2d×2d leaf product slip (87×83=6921) | self-written memoization table `T` at trace start, `d|p` notation per leaf |
| 7 | Bare-combine slip (1278 → 781) | bring back explicit `P1*10+P2=prod` equation |
| 8 | Carry-split slip (8818 → c87 instead of c88) | chained equation `sum+c=total=carry*100+cell` |
| 9 | Bare-`prod` recap line drift | uniform pair-line shape, first line writes `0+prod=prod` |
| 10 | End-of-trace prose drift ("Now I need to…") | `DONE` token + `stopSequences: ["DONE"]` + STOP_TOKEN preamble |
| 11 | `j = k - i` per-pair subtraction error | structural: cross-slide variant uses reversed-B (`R`) tape; both indices increment monotonically by +1 |
| 12 | 64-cell tape transcription slip during REFRESH | hand R pre-reversed in user input — model only transcribes, never reverses |

### Trim continuation is the load-bearing primitive

Every successful run uses **trim continuation** — assistant prefill is
sliced from the most recent FIRE with completed REFRESH, plus the
trace prelude (`CHUNK=2` + T table) injected with a
`<HISTORY_TRUNCATED>` marker. The full prior trace is never re-sent.

This means context length is **not** the bottleneck. The bound is on
the size of a single FIRE window (~12 row units of work). The trace
can be arbitrarily long as long as each step's local context fits.

This is the substrate analogue of a Turing machine's unbounded tape:
each "instruction" sees only a finite local window, but the tape can
extend forever.

### Observations on which fixes are doing the most work

- The cross-slide reformulation (reversed-B tape) is structural —
  it makes pair-line indexing monotonic in both dimensions. This
  alone removes an entire error class (`j = k - i` arithmetic).
- The chained equations (`P1*10+P2=prod`, `sum+c=total=carry*100+cell`)
  are anchoring: bare-number versions slip silently; equation versions
  break visibly when wrong. Token cost ~2× per row-end line; reliability
  gain seems worth it.
- The memoization table `T` may be partly redundant: it lives in the
  trace prelude and is re-sent on every continuation via the
  `<HISTORY_TRUNCATED>` injection, but the model's mental 1d×2d
  products are reliable enough that the table may not be load-bearing.
  Worth testing whether removing T degrades reliability at 128 scale
  before assuming it's necessary.
- The `<HISTORY_TRUNCATED>` marker turned out to matter more than
  expected: without it the model on resume would fall back to
  re-emitting the trace prelude (CHUNK=, START before that), losing
  position completely.

### Cost

128×128 run cost on the order of $1–$3 (estimate; needs measurement).
Output ~50-60k tokens; input cached after first call. Roughly linear
per output digit, consistent with prior smaller scales.

### What's left to push toward 256×256

- The cell-by-cell work scales as N×M = 4× from 128×128 to 256×256.
  Trace length scales similarly. Per-row pair count peaks at N=128
  pairs at the diagonal.
- The `k % REFRESH_INTERVAL` and `iLast` shapes scale fine; the cycle
  counter doesn't care about N.
- The OUT tape at the last FIRE before RETURN would have ~240 cells
  for 256-digit — bigger transcription but same shape as the 112-cell
  case at 128×128 that worked.
- Likely next ceilings: attention reach to the operand REFRESH at
  very long traces; cost of re-emitting OUT at every FIRE (grows
  linearly with the half it's in).

## Cache pricing observations

- System prompt (training tape + algorithm examples) caches once,
  hits on every continuation call after that.
- Per-continuation assistant block marked with `cacheControl: ephemeral`
  caches the prior partial response — eliminates re-processing.
- Combined: a multi-call run pays full-rate for the first call and
  near-cache-rate for subsequent calls.
- Removing the "drop BEGIN RESPONSE WITH on iter>0" mutation kept the
  system prompt byte-stable across continuations, which is required for
  cache hits.

## Trim continuation: decoupling computation length from context length

The biggest substrate-level shift: when continuation prefills are
**trimmed** (assistant context bounded to one step's worth instead of
the whole accumulated trace), total computation size is no longer
bounded by the model's context window. The bound becomes the size of a
single **step**.

For a deterministic trace where every state needed to compute step k+1
is recoverable from (a) a bounded suffix of step k's output and (b) a
fixed system message, the run can be arbitrarily long as long as one
step + its self-written state summary fits inside one API call's input
budget.

What makes this work:

- **Self-anchored steps.** Each step writes its own situational summary
  at its start, e.g.
  `RESUME k=N tick=T/16 FIRE|SKIP carry=C prev=O… pairs=P i0=X t0=Y`.
  On resume the model re-establishes frame from this line alone — no
  need to attend to anything earlier in the trace.
- **Boundary-aware slicing.** The trim prefill is sliced from the most
  recent step whose entry preamble is fully visible (`continueBoundary`
  + `continueAnchor` — the anchor enforces that e.g. `END_REFRESH` has
  finished emitting before that boundary qualifies as a slice point;
  otherwise the slicer backs up to the previous qualifying step).
- **Externalized counters.** Anything the model would otherwise compute
  modulo something (FIRE/SKIP cycle, row-end) is written as an
  explicit bounded counter in the trace (`tick=T/16`, `[i/n]`). The
  model increments by 1 and wraps. No implicit modular arithmetic.
- **Cache-stable system.** System message is byte-identical on every
  call (no per-call instruction, no startToken directive). Training
  tape is cached once and read on every continuation.

Consequence: context window stops being a frontier. The trace can span
many API calls without per-call quadratic input cost — each call only
re-reads (cached) system + (small) prefill + emits one new window of
tokens. The computable problem size is governed by how big a single
step's self-summary is, not by total output length.

This is the substrate analogue of a Turing machine writing to an
unbounded tape: each instruction sees only a finite local window of the
tape, but the tape can be arbitrarily long.

## Things to try

- Verify REFRESH-every-block fixes 128×128.
- 256×256 if 128×128 passes.
- chunk=3 with REFRESH (test whether 3×3 mental arithmetic at large N
  is reliable with attention-refresh).
- Toom-3 over cross-memo base case (asymptotic gain at very large N).
- Carry-Save / Deferred-Carry cross — separate phases for products and
  carries, uniform per-phase line shape.
- Sliding-window cell refresh (constant-cost refresh per block, only
  recent cells re-stated).
- Characterize attention-horizon empirically: at what k-depth does the
  model fail to retrieve a cell value? That's the substrate's H.

## Lib + program structure

- `src/lib/`: format-agnostic harness (runner, IO, types, program type).
- `programs/encoding.ts`: positional encoding helpers (downstream of
  src/lib).
- `programs/utils.ts`: random / shuffle helpers.
- Each program is a single `index.ts` + `eval.ts`, defining a `Program`
  via `defineProgram` and calling `runProgram`.
- CLI: `bun programs/<name> [model-slug] [extra positionals] [--flags]`.
- Per-program flags (e.g. `--chunk=N`) handled via `opts.flags`
  forwarded from the lib's `parseArgs`.
