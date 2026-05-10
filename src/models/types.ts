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
}

export interface GPTTestOptions {
  system?: string;
  messages: ModelMessage[];
  model?: OpenAIGatewayModel;
  main?: boolean;
  solution: string;
}
