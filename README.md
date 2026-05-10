### Opus as a Turing Machine

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.10984995.svg)](https://doi.org/10.5281/zenodo.10984995)

Given only a series of input tapes, Opus learns to compute solutions for the
A::B problem with 100% accuracy at 24 steps, and Rule 110 for a 12-token tape
over 12 steps (accuracy over large runs not yet measured). 

See:
 - [`programs/ab/train.txt`](programs/ab/train.txt)
 - [`programs/automata/train.txt`](programs/automata/train.txt)

## Running tests

Each subdirectory of `programs/` is a self-contained experiment with the files:

| File | Purpose |
| --- | --- |
| `train.txt` | System prompt — worked examples the model conditions on. |
| `config.json` | `temperature`, `max_tokens`, and a `models` map (e.g. `openai`, `anthropic`). |
| `tests.jsonl` | One JSON object per line, each with an `input` field. |
| `eval.ts` | Default-exports a function that produces the ground-truth output for a given input. |
| `test.ts` | Entry point — calls the shared harness in [`src/test.ts`](src/test.ts). |
| `create-train.ts`, `create-test.ts` | (Optional) regenerate `train.txt` / `tests.jsonl`. |

The shared harness streams the model's response and rolling-checks each chunk
against `eval.ts`'s ground truth, aborting on the first divergence.

### Prerequisites

- [Bun](https://bun.sh)
- `bun install`
- An API key for the provider you want to use:
  - OpenAI: `OPENAI_API_KEY` env var (or `~/.config/openai.token`)
  - Anthropic: routed through Vertex AI (`research-420207`, `us-east5`) via
    `AnthropicVertex`. Adjust [`src/models.ts`](src/models.ts) if you want to
    use the direct Anthropic API instead.

### Run an experiment

```bash
# default model (openai)
bun programs/<name>/test.ts

# pick a provider key from config.json's "models" map
bun programs/<name>/test.ts openai
bun programs/<name>/test.ts anthropic
```

Available `<name>`s: `ab`, `arithmetic`, `arithmetic-tape`, `automata`.

The provider argument is the **key** in `config.json`'s `models` object — e.g.
in `programs/arithmetic-tape/config.json`, `openai` maps to `o1` and
`anthropic` maps to `claude-3-opus@20240229`.

### Regenerate inputs

For programs that ship with generators:

```bash
bun programs/<name>/create-train.ts
bun programs/<name>/create-test.ts
```

### Package scripts (hardcoded to `arithmetic-tape`)

```bash
bun start          # regenerates train + test, then runs arithmetic-tape
bun create-train   # regenerates programs/arithmetic-tape/train.txt
bun create-test    # regenerates programs/arithmetic-tape/tests.jsonl
```