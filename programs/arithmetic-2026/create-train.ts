import { clearTrainingTape, addToTrainingTape, toPositional } from "../utils"
import multiply from "./eval"

await clearTrainingTape()

/**
 * Two worked examples, pure protocol, no English.
 *
 * - Short (3-nibble × 3-nibble): exposes every opcode form (PREPARE, JOIN,
 *   outer header, fused 2-line inner step, B=0 skip, full O snapshot,
 *   RETURN) in compact form.
 * - Medium (6-nibble × 6-nibble): shows multi-iteration carry chains, more
 *   skip lines, and reprints, so the model induces the periodic structure.
 */

type HexPair = [string, string]

const examples: HexPair[] = [
  // 2x2 small, no skips — establishes the basic 4-line inner step.
  ["7e", "23"],
  // 3x3 with mid-stream skip (B1=0).
  ["a3f", "207"],
  // 2x3 with start-of-trace skip (B's LSB = 0).
  ["9c", "830"],
  // 4x4 no skips — anchors position tracking at the exact width tests use.
  ["1234", "5678"],
  // 4x4 with start-of-trace skip (B's LSB = 0) — direct analog of smoke test.
  ["abc1", "9d20"],
  // 4x4 with mid-stream skip (B1=0).
  ["7f3a", "8025"],
  // 6x6 multi-iteration with mid-stream skip (B4=0).
  ["c4d801", "9af20b"],
]

for (const [a, b] of examples) {
  await addToTrainingTape(multiply, toPositional(a), toPositional(b))
}
