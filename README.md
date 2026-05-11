# Opus as a Turing Machine

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.10984995.svg)](https://doi.org/10.5281/zenodo.10984995)

Given a finite training tape of input/output pairs, the model learns to
execute a programmatic algorithm in-context, step by step, producing a
trace that is byte-identical to a deterministic reference evaluator.

This repo is a harness for that style of experiment: each *program* is a
pair of files — `index.ts` (config + training inputs) and `eval.ts` (the
reference evaluator that produces the trace) — and the runner streams
the model's emission against the reference, character-by-character, with
explicit continuation handling when the response overflows.

## Current frontier — 128 × 128 decimal multiplication

The flagship program (`arithmetic-2026-cross-slide`) multiplies two
**128-digit decimal numbers** to a **256-digit product**, single run,
100% match against the reference trace.

```
A × B ≈ 2.2 × 10²⁵⁵
```

For reference:

| Quantity                          | Magnitude   |
|-----------------------------------|-------------|
| Atoms in the observable universe  | 10⁸⁰        |
| Legal chess positions (Shannon)   | ~10⁴⁰       |
| Estimated distinct chess games    | ~10¹²⁰      |
| Planck volumes in the universe    | ~10¹⁸³      |
| **128-digit × 128-digit product** | **~10²⁵⁵**  |

Published literature on transformer arithmetic tops out at 5-digit ×
5-digit decimal (Wan et al. 2024, 99.9%, fine-tuned). This is **~25×
linear scale-up** on a general-purpose model with no fine-tuning, no
external tools, and no calculator — just a training tape and a stream
of the model's own emissions.

See [`ideas.md`](ideas.md) for the failure-mode cascade and the
design principles that hold at this scale.

## Substrate properties

Six properties make this work, and each is necessary:

1. **Deterministic-single-direction trace.** Every emitted token is a
   function of tokens to its immediate left. No reach-back further than
   the model can reliably attend.
2. **Externalized counters.** Any modular bookkeeping the model would
   otherwise do implicitly (cycle counters, row-end conditions) is
   written explicitly into the trace as a small bounded counter (e.g.
   `tick=N/12`, `[i/iLast]`).
3. **Memoization on operations the model would otherwise repeat.** For
   `chunk=2` decimal, the model writes its own `A_i_av: 0|0 1|av 2|2av
   ... 9|9av` lookup table once at trace start, then references it for
   every leaf product.
4. **Cross-check equations on each computation.** Bare numeric
   emissions slip silently. Equations (`P1*10+P2=prod`,
   `total=carry*BASE+cell`) break visibly when wrong, so errors
   self-anchor.
5. **Trim continuation.** On overflow, the assistant prefill is sliced
   to the most recent FIRE block with completed REFRESH. Total trace
   length stops being bounded by context window; the bound becomes the
   size of one FIRE window.
6. **Explicit end-of-program marker + stop sequence.** `DONE` token
   prevents end-of-trace prose drift.

## Programs

- `programs/arithmetic-2026-cross-slide` — flagship. 128-digit
  decimal multiplication via Tanton's sliding-strip reformulation
  (reversed-B tape → both pair indices monotonic). Memoization table,
  `digit|product` decomp leaves, chained carry equation, uniform
  pair lines, `DONE` stop.
- `programs/arithmetic-2026-cross-memo` — earlier decimal-cross
  variant, no reversed-B. Reliable up through ~96-digit operands.
- `programs/arithmetic-2026-kara-memo` — Karatsuba over cross-memo
  for sub-multiplications.
- `programs/arithmetic-2026-karatsuba` — pure Karatsuba.
- `programs/arithmetic-2026` — nibble-level binary multiplication.
- `programs/ab` — A::B reduction puzzle (original Turing-Opus result).
- `programs/automata` — Rule 110 cellular automaton.
- `programs/sha256` — SHA-256 emission.

## Running

```sh
bun install
bun programs/<program> [model-slug] [extra positional args] [--flags]
```

Example:

```sh
bun programs/arithmetic-2026-cross-slide \
  anthropic/claude-opus-4.6 \
  128 128 \
  --chunk=2 --n=1
```

Flags the lib understands:

- `--n=N` — run only the first N tests.
- `--batch=N` — run N tests in parallel.
- `--from=K` — warm-start at row k=K (pre-populates the trace through
  the row before K from the reference; the model only computes from
  K onward). Useful for testing whether the model handles the heavy
  middle without grinding through the easy ramp-up.
- `--debug` — also write `train.txt` and `tests.jsonl` to the program
  directory.

Set `AI_GATEWAY_API_KEY` (Vercel AI Gateway), `ANTHROPIC_API_KEY`, or
`OPENAI_API_KEY` in the environment.

## CI

`.github/workflows/run-arithmetic-cross-slide.yml` and
`.github/workflows/run-program.yml` provide `workflow_dispatch`
entry points to run any program from the GitHub Actions UI.

The runner exits non-zero (`process.exit(1)`) when any test fails so
CI reports the run as a failure.

## Earlier results

The 2024 paper (DOI above) showed Claude Opus learning A::B at 24
steps and Rule 110 over 12 steps, given only a training tape of
input/output pairs and no external tools.

The current decimal-multiplication work extends that: instead of a
small abstract substrate, the algorithm is large enough (4000+ pair
operations at 128×128) that every property listed above becomes
load-bearing. See `ideas.md` for the design rationale and the
failure-mode log that produced the current shape.

## Lib + program layout

- `src/lib/` — format-agnostic harness: runner, IO, types, program
  definition helpers.
- `src/models/` — provider adapters (Anthropic streaming with trim
  continuation; OpenAI single-call).
- `programs/encoding.ts`, `programs/utils.ts` — shared helpers.
- Each program: `index.ts` (defines a `Program` via `defineProgram`
  and calls `runProgram`) + `eval.ts` (reference evaluator).

## License

[`LICENSE`](LICENSE)
