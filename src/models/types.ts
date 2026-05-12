import type { ModelMessage } from "ai"

/**
 * Gateway model string of the form "<provider>/<model>".
 * The `(string & {})` branch keeps autocomplete on known prefixes while still
 * accepting any provider/model the gateway routes.
 */
// eslint-disable-next-line @typescript-eslint/ban-types
export type GatewayModel = `anthropic/${string}` | `openai/${string}` | (string & {})

export type TestResult = {
  pass: boolean;
  text: string;
  metadata: unknown;
}

export interface ModelTestOptions {
  system?: string;
  messages: ModelMessage[];
  max_tokens?: number;
  model?: GatewayModel;
  temperature?: number;
  debug?: boolean;
  main?: boolean;
  solution: string;
  startToken: string | null;
  /** Regex marking the start of a step (the slice point). On
   *  overflow, the prefill is sliced at the start of one of the
   *  most recent complete steps. */
  continueStart?: RegExp;
  /** Pattern (string or regex) marking the end of a step. A start
   *  qualifies as complete only when a matching end appears later
   *  in the trace. The earlier of (first start, first end)
   *  determines where the algorithmic header ends. */
  continueEnd?: string | RegExp;
  /** Number of complete steps to include in the prefill. Default 1
   *  (most recent). Must be >= 1; values below clamp to 1. */
  continueWindow?: number;
  /** "trim": replace assistant prefill each call (sliced).
   *  "stack": append each completed chunk as its own assistant message. */
  continuationMode?: "trim" | "stack";
  /** Optional pre-populated trace. When set, the continuation loop
   *  starts already past iteration 1 — useful for warm-starting from
   *  a known-good prefix. */
  warmPrefill?: string;
  /** Stop sequences passed to the API. */
  stopSequences?: string[];
  /** Optional callback invoked each time a continuation prefill is
   *  built. Used in --debug mode to dump the slicer's output to
   *  disk so the human can see exactly what the model receives on
   *  resume. */
  onContinuation?: (chunkN: number, prefill: string) => void | Promise<void>;
  /** OpenAI reasoning models: effort level. Defaults to "none" for
   *  deterministic-trace tasks where the model is transcribing/computing
   *  rather than reasoning. Valid: "none" | "low" | "medium" | "high" | "xhigh". */
  reasoningEffort?: "none" | "low" | "medium" | "high" | "xhigh";
}
