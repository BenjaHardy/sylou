import { describe, it, expect } from "vitest";
import { formatReasoningDisclosure } from "../shared-utils";
import type { FlowMeta } from "@/hooks/useFlowAnalysis";

const base: FlowMeta = {
  estimated_input_tokens: 0,
  context_limit_tokens: 0,
  token_status: "ok",
  measured_at: "",
};

const make = (overrides: Partial<FlowMeta>): FlowMeta => ({ ...base, ...overrides });

describe("formatReasoningDisclosure", () => {
  it("returns empty for null/undefined meta (legacy)", () => {
    expect(formatReasoningDisclosure(null)).toBe("");
    expect(formatReasoningDisclosure(undefined)).toBe("");
    expect(formatReasoningDisclosure(base)).toBe(""); // no reasoning fields = legacy
  });

  it("returns empty when reasoning_provider is null", () => {
    expect(formatReasoningDisclosure(make({ reasoning_provider: null }))).toBe("");
  });

  it("anthropic with thinking + effort", () => {
    expect(formatReasoningDisclosure(make({
      reasoning_provider: "anthropic", reasoning_thinking: true, reasoning_effort: "high",
    }))).toBe(", thinking on, effort high");
    expect(formatReasoningDisclosure(make({
      reasoning_provider: "anthropic", reasoning_thinking: false, reasoning_effort: "high",
    }))).toBe(", thinking off, effort high");
  });

  it("anthropic with thinking only", () => {
    expect(formatReasoningDisclosure(make({
      reasoning_provider: "anthropic", reasoning_thinking: true, reasoning_effort: null,
    }))).toBe(", thinking on");
    expect(formatReasoningDisclosure(make({
      reasoning_provider: "anthropic", reasoning_thinking: false, reasoning_effort: null,
    }))).toBe(", thinking off");
  });

  it("anthropic with effort only", () => {
    expect(formatReasoningDisclosure(make({
      reasoning_provider: "anthropic", reasoning_thinking: null, reasoning_effort: "high",
    }))).toBe(", effort high");
  });

  it("anthropic with both null", () => {
    expect(formatReasoningDisclosure(make({
      reasoning_provider: "anthropic", reasoning_thinking: null, reasoning_effort: null,
    }))).toBe("");
  });

  it("mistral with effort", () => {
    expect(formatReasoningDisclosure(make({
      reasoning_provider: "mistral", reasoning_thinking: null, reasoning_effort: "high",
    }))).toBe(", reasoning_effort high");
    expect(formatReasoningDisclosure(make({
      reasoning_provider: "mistral", reasoning_thinking: null, reasoning_effort: "none",
    }))).toBe(", reasoning_effort none");
  });

  it("mistral with null effort", () => {
    expect(formatReasoningDisclosure(make({
      reasoning_provider: "mistral", reasoning_thinking: null, reasoning_effort: null,
    }))).toBe("");
  });

  it("unknown future provider falls back to reasoning_effort rendering", () => {
    expect(formatReasoningDisclosure(make({
      reasoning_provider: "openai", reasoning_thinking: null, reasoning_effort: "medium",
    }))).toBe(", reasoning_effort medium");
    expect(formatReasoningDisclosure(make({
      reasoning_provider: "openai", reasoning_thinking: null, reasoning_effort: null,
    }))).toBe("");
  });

  it("treats empty-string reasoning_effort as null (defensive)", () => {
    expect(formatReasoningDisclosure(make({
      reasoning_provider: "mistral", reasoning_thinking: null, reasoning_effort: "",
    }))).toBe("");
    expect(formatReasoningDisclosure(make({
      reasoning_provider: "anthropic", reasoning_thinking: true, reasoning_effort: "",
    }))).toBe(", thinking on");
  });
});
