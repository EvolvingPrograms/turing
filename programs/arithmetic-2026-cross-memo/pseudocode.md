# Cross-Memo Pseudocode

The algorithm the model is being asked to simulate, in plain pseudocode.
The actual trace it emits is a deterministic line-by-line transcript of
this execution — every named value below appears verbatim as a tape token.

## Setup

```
CHUNK         := 2                          # base-10^CHUNK cell size
BASE          := 10^CHUNK                   # 100 when CHUNK=2
REFRESH_EVERY := 8                          # tick cycle length

A := split(operand_a, CHUNK)                # LSB-first cells, A[0] is least-significant
B := split(operand_b, CHUNK)
N := len(A)
M := len(B)
out   := []
carry := 0
```

## Outer loop — one output cell per k

```
for k in 0 .. N+M-2:

    tick := k mod REFRESH_EVERY

    # Attention-maintenance: re-print operand tapes every REFRESH_EVERY
    # iterations so the model never has to attend back more than ~8 k-blocks
    # to find a cell value.
    if tick == 0:
        emit "tick={tick} [FIRE]"
        emit "REFRESH"
        emit tape(A, prefix="A")             # multi-line if >8 cells
        emit tape(B, prefix="B")
        emit "END_REFRESH"
    else:
        emit "tick={tick} [SKIP]"

    emit "k={k}"

    # Diagonal of the convolution at index k
    pairs := [ (i, k-i) for i in max(0, k-(M-1)) .. min(N-1, k) ]

    # Pair-grouped accumulation. Every line shows two products and the
    # running sum update, so the model only needs to attend 1 line back.
    sum := 0
    p   := 0
    while p < len(pairs):
        if p+1 < len(pairs):
            (i1, j1) := pairs[p]
            (i2, j2) := pairs[p+1]
            prod1 := A[i1] * B[j1]
            prod2 := A[i2] * B[j2]
            pair_sum := prod1 + prod2

            if p == 0:
                sum := pair_sum
                emit "Ai1_av1*Bj1_bv1=prod1 Ai2_av2*Bj2_bv2=prod2  prod1+prod2=pair_sum  sum=sum"
            else:
                prev    := sum
                new_sum := prev + pair_sum
                emit "Ai1_av1*Bj1_bv1=prod1 Ai2_av2*Bj2_bv2=prod2  prod1+prod2=pair_sum  prev+pair_sum=new_sum  sum=new_sum"
                sum := new_sum

            p := p + 2
        else:
            (i, j) := pairs[p]
            prod   := A[i] * B[j]

            if p == 0:
                sum := prod
                emit "Ai_av*Bj_bv=prod  sum=prod"
            else:
                prev    := sum
                new_sum := prev + prod
                emit "Ai_av*Bj_bv=prod  prev+prod=new_sum  sum=new_sum"
                sum := new_sum

            p := p + 1

    # Apply carry, split into this cell + carry-out
    total     := sum + carry
    emit "sum+c{carry}={total}"

    cell      := total mod BASE
    new_carry := total div BASE
    out.push(cell)
    emit "O{k}_{cell pad CHUNK} c{new_carry}"
    carry := new_carry

# Final cell is just the remaining carry
out.push(carry)
emit "k={N+M-1}"
emit "O{N+M-1}_{carry pad CHUNK}"

emit "RETURN " + tape(out, prefix="O")
```

## Trace primitives the model emits

| Token            | Meaning                                                               |
|------------------|-----------------------------------------------------------------------|
| `START`          | First line of every trace.                                            |
| `CHUNK=N`        | Declares cell size.                                                   |
| `tick=N [FIRE]`  | Refresh iteration. The next lines re-print A and B tapes.             |
| `tick=N [SKIP]`  | Non-refresh iteration. Skip directly to `k=`.                         |
| `REFRESH` / `END_REFRESH` | Brackets the tape re-print so it can't be confused with output. |
| `Ai_av`          | Cell i of A has value av (zero-padded to CHUNK digits).               |
| `Bj_bv`          | Cell j of B has value bv.                                             |
| `prod1+prod2=ps` | Pair-sum: explicit 2-operand add of this line's two products.         |
| `prev+ps=ns`     | Running-sum update: prev was the trailing `sum=...` of the line above.|
| `sum=N`          | Trails every accumulator line. Always the current running sum.        |
| `sum+cC=T`       | Adds carry-in to the diagonal sum.                                    |
| `Ok_vc`          | Output cell k = vc. Cell value is `T mod BASE`.                       |
| `cN`             | New carry = `T div BASE`. Becomes the next iteration's carry-in.      |
| `RETURN O0_.. O1_.. ...` | Final answer tape, LSB-first.                                 |

## Why each piece exists

- **Cells (not digits)**: At CHUNK=2 the per-cell multiplication is at most
  99×99=9801 — small enough that the model produces it reliably as one
  emit. 4× fewer products than digit-level cross.
- **LSB-first**: input encoding matches tape direction, so no mental
  reversal during copy. Long tapes used to drift in the middle when the
  model had to flip indexing.
- **Pair-grouping**: two products per line gives uniform line shape and
  halves the number of accumulator lines. Alternating `multiply` and
  `sum` line types caused attention drift past ~8 products.
- **Explicit `prod1+prod2=pair_sum` and `prev+pair_sum=new_sum`**: every
  arithmetic step is a 2-operand equation visible on the same line.
  No implicit intermediates the model has to compute and remember.
- **Uniform trailing `sum=N`**: the running sum is always exactly 1 line
  back, in the same column. Reach distance is constant regardless of
  trace length.
- **`tick=N [FIRE|SKIP]` counter**: bounded 0..7 cycle externalized as a
  token. The model never tracks "is this iteration a refresh" internally —
  every iteration tells itself.
- **`REFRESH` re-prints A and B**: bounds the attention distance to any
  cell value at ~8 k-blocks. Without refresh, distance grows linearly with
  trace length and the model eventually misreads a cell.
- **`TAPE_CHUNK=8` per line**: 16+ structurally-identical cells on one
  line drift in the middle. Wrapping at 8 keeps each tape line within
  reliable copy range.
