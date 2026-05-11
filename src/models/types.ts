import type { ModelMessage } from "ai"

/**
 * Gateway model strings of the form "<provider>/<model>".
 * The `(string & {})` branch keeps autocomplete on known prefixes while still
 * accepting any provider/model the gateway routes.
 */
// eslint-disable-next-line @typescript-eslint/ban-types
export type AnthropicGatewayModel = `anthropic/${string}` | (string & {})
// eslint-disable-next-line @typescript-eslint/ban-types
export type OpenAIGatewayModel = `openai/${string}` | (string & {})

export type TestResult = {
  pass: boolean;
  text: string;
  metadata: unknown;
}

export interface ClaudeTestOptions {
  system?: string;
  messages: ModelMessage[];
  max_tokens?: number;
  model?: AnthropicGatewayModel;
  temperature?: number;
  debug?: boolean;
  main?: boolean;
  solution: string;
  startToken: string | null;
  /** Optional regex marking step boundaries. When the response overflows,
   *  the assistant prefill for the continuation is sliced from the last
   *  match in the full trace so the model resumes inside a complete step.
   *  Only used when continuationMode === "trim". */
  continueBoundary?: RegExp;
  /** Optional anchor string. A boundary match is only used if this string
   *  appears in the trace AFTER the match — i.e. the step the boundary
   *  starts has reached this checkpoint. Used to avoid slicing into an
   *  in-progress step (e.g. a FIRE row whose REFRESH hasn't finished). */
  continueAnchor?: string;
  /** How to assemble messages across overflow continuations. See Program. */
  continuationMode?: "trim" | "stack";
  /** Optional pre-populated trace. When set, testWithClaude enters the
   *  continuation loop already at iteration 1 — fullTrace starts equal
   *  to warmPrefill, and the first API call sends an assistant prefill
   *  derived from it (via continueBoundary slicing) plus a CONTINUE user
   *  turn. Used to skip ahead in a long deterministic trace (e.g. test
   *  whether the model handles the heaviest middle rows without first
   *  having to grind through the easy ramp-up). */
  warmPrefill?: string;
  /** Stop sequences passed to the API. Model halts after emitting any
   *  of these. Used for explicit end-of-program markers. */
  stopSequences?: string[];
}

export interface GPTTestOptions {
  system?: string;
  messages: ModelMessage[];
  model?: OpenAIGatewayModel;
  main?: boolean;
  solution: string;
}
