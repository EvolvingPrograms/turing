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
  /** Optional regex marking step boundaries. On overflow, the assistant
   *  prefill for the continuation is sliced from the last match in the
   *  full trace so the model resumes inside a complete step.
   *  Only used when continuationMode === "trim". */
  continueBoundary?: RegExp;
  /** Optional anchor string. A boundary match only qualifies when this
   *  string appears in the trace AFTER the match — used to avoid
   *  slicing into an in-progress step. */
  continueAnchor?: string;
  /** "trim": replace assistant prefill each call (sliced).
   *  "stack": append each completed chunk as its own assistant message. */
  continuationMode?: "trim" | "stack";
  /** Optional pre-populated trace. When set, the continuation loop
   *  starts already past iteration 1 — useful for warm-starting from
   *  a known-good prefix. */
  warmPrefill?: string;
  /** Stop sequences passed to the API. */
  stopSequences?: string[];
  /** OpenAI reasoning models: effort level. Defaults to "none" for
   *  deterministic-trace tasks where the model is transcribing/computing
   *  rather than reasoning. Valid: "none" | "low" | "medium" | "high" | "xhigh". */
  reasoningEffort?: "none" | "low" | "medium" | "high" | "xhigh";
}
