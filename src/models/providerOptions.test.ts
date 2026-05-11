import { test, expect } from "bun:test"
import { disableReasoningOptions } from "./model"

test("anthropic: thinking disabled", () => {
  expect(disableReasoningOptions("anthropic/claude-opus-4.6")).toEqual({
    anthropic: { thinking: { type: "disabled" } },
  })
})

test("openai: reasoningEffort=none by default", () => {
  expect(disableReasoningOptions("openai/gpt-5")).toEqual({
    openai: { reasoningEffort: "none" },
  })
})

test("openai: caller can override reasoningEffort (e.g. gpt-5 needs minimal)", () => {
  expect(disableReasoningOptions("openai/gpt-5", { reasoningEffort: "minimal" })).toEqual({
    openai: { reasoningEffort: "minimal" },
  })
})

test("deepseek: thinking disabled", () => {
  expect(disableReasoningOptions("deepseek/deepseek-v4-pro")).toEqual({
    deepseek: { thinking: { type: "disabled" } },
  })
})

test("google: thinkingBudget=0", () => {
  expect(disableReasoningOptions("google/gemini-3-pro")).toEqual({
    google: { thinkingConfig: { thinkingBudget: 0 } },
  })
})

test("unknown provider returns empty object (no opinionated default)", () => {
  expect(disableReasoningOptions("alibaba/qwen3.6-max-preview")).toEqual({})
  expect(disableReasoningOptions("moonshotai/kimi-k2.6")).toEqual({})
  expect(disableReasoningOptions("xiaomi/mimo-v2.5-pro")).toEqual({})
  expect(disableReasoningOptions("zai/glm-5.1")).toEqual({})
  expect(disableReasoningOptions("xai/grok-4")).toEqual({})
  expect(disableReasoningOptions("minimax/minimax-m2.7")).toEqual({})
})

test("empty / malformed slug returns empty object", () => {
  expect(disableReasoningOptions("")).toEqual({})
  expect(disableReasoningOptions("just-a-model-name-no-slash")).toEqual({})
})
