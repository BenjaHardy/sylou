// Registry sanity tests for the frontend model registry (P4-5) —
// the client-side mirror of the edge functions' _shared/_models checks.
import { describe, it, expect } from "vitest";
import {
  CHAT_REASONING_OPTIONS,
  DEFAULT_CHAT_MODEL,
  DEFAULT_FLOW_MODEL,
  FLOW_OTHER_GROUP_ID,
  FLOW_RECOMMENDED_GROUP_ID,
  MODELS,
  MODEL_LABELS,
  PROVIDER_LABELS,
  effectiveReasoningId,
  groupModelsByProvider,
  groupModelsForFlow,
  reasoningLabelFor,
  type ModelInfo,
} from "@/lib/models";

describe("MODELS registry", () => {
  it("ids are unique and non-empty", () => {
    const ids = MODELS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.trim()).not.toBe("");
  });

  it("every id matches its provider's routing prefix (mirrors _llm.ts routing)", () => {
    for (const m of MODELS) {
      if (m.id.startsWith("claude-")) expect(m.provider, m.id).toBe("anthropic");
      else if (m.id.startsWith("deepseek-")) expect(m.provider, m.id).toBe("deepseek");
      else expect(m.provider, m.id).toBe("mistral");
    }
  });

  it("pricing and context limits are sane", () => {
    for (const m of MODELS) {
      expect(m.pricing.input, m.id).toBeGreaterThan(0);
      expect(m.pricing.output, m.id).toBeGreaterThanOrEqual(m.pricing.input);
      expect(m.contextLimit, m.id).toBeGreaterThanOrEqual(128_000);
    }
  });

  it("no registry model uses a rolling alias (pinned-versions policy)", () => {
    for (const m of MODELS) expect(m.isRollingLatest, m.id).toBeFalsy();
  });

  it("exactly one model is recommended for FLOW: Claude Sonnet 4.6 (GLM 5.3 failed the field test, 2026-10-02)", () => {
    const recommended = MODELS.filter((m) => m.flowRecommended);
    expect(recommended.map((m) => m.id)).toEqual(["claude-sonnet-4-6"]);
  });

  it("no recommended model carries the experimental badge", () => {
    for (const m of MODELS) {
      if (m.flowRecommended) expect(m.isExperimental, m.id).toBeFalsy();
    }
  });

  it("the recommendation lives in the flag, not in note wording (the FLOW group conveys it)", () => {
    for (const m of MODELS) expect(m.note ?? "", m.id).not.toMatch(/recommended/i);
  });

  it("the defaults for new profiles are GLM 5.3 for chat and Claude Sonnet 4.6 for FLOW (maintainer decisions 2026-09-30 / 2026-10-02), and the FLOW default is a recommended model", () => {
    expect(DEFAULT_CHAT_MODEL).toBe("zai-glm-5-3");
    expect(DEFAULT_FLOW_MODEL).toBe("claude-sonnet-4-6");
    expect(MODELS.map((m) => m.id)).toContain(DEFAULT_CHAT_MODEL);
    expect(MODELS.find((m) => m.id === DEFAULT_FLOW_MODEL)?.flowRecommended).toBe(true);
  });

  it("a retired id keeps a label so historical reports still render one (GLM 5.2, retired by Mistral 2026-10-31)", () => {
    expect(MODELS.map((m) => m.id)).not.toContain("zai-glm-5-2");
    expect(MODEL_LABELS["zai-glm-5-2"]).toBe("Z.ai GLM 5.2 (via Mistral)");
  });
});

describe("Settings picker groupings", () => {
  const ids = (models: ModelInfo[]) => models.map((m) => m.id);

  it("chat: grouped by serving API, in the agreed order, GLM under the Mistral API", () => {
    const groups = groupModelsByProvider();
    expect(groups.map((g) => [g.id, g.label])).toEqual([
      ["anthropic", "Anthropic (Claude)"],
      ["mistral", "Mistral API"],
      ["other", "Other providers"],
    ]);
    expect(ids(groups[0].models)).toEqual(["claude-sonnet-4-6", "claude-opus-4-8"]);
    expect(ids(groups[1].models)).toEqual([
      "mistral-small-2603",
      "mistral-medium-3-5",
      "mistral-large-2512",
      "zai-glm-5-3",
    ]);
    expect(ids(groups[2].models)).toEqual(["deepseek-v4-flash"]);
  });

  it("FLOW: recommended first, everything else in the second group", () => {
    const groups = groupModelsForFlow();
    expect(groups.map((g) => g.id)).toEqual([FLOW_RECOMMENDED_GROUP_ID, FLOW_OTHER_GROUP_ID]);
    expect(ids(groups[0].models)).toEqual(["claude-sonnet-4-6"]);
    expect(groups[1].models.every((m) => !m.flowRecommended)).toBe(true);
  });

  it("every model appears exactly once in each grouping", () => {
    for (const grouping of [groupModelsByProvider(), groupModelsForFlow()]) {
      const grouped = grouping.flatMap((g) => ids(g.models)).sort();
      expect(grouped).toEqual(ids(MODELS).sort());
    }
  });

  it("empty groups are omitted, and an unknown provider lands in 'Other providers'", () => {
    const onlyClaude = MODELS.filter((m) => m.provider === "anthropic");
    expect(groupModelsByProvider(onlyClaude).map((g) => g.id)).toEqual(["anthropic"]);
    expect(groupModelsForFlow(onlyClaude.filter((m) => m.flowRecommended)).map((g) => g.id)).toEqual([
      FLOW_RECOMMENDED_GROUP_ID,
    ]);

    const future = { ...MODELS[0], id: "newco-model-1", provider: "newco" as ModelInfo["provider"] };
    expect(groupModelsByProvider([future]).map((g) => g.id)).toEqual(["other"]);
  });

  it("every provider has a tag label for the FLOW cards", () => {
    for (const m of MODELS) expect(PROVIDER_LABELS[m.provider], m.id).toBeTruthy();
  });
});

describe("chat reasoning options (UI mirror of _shared/_thinking.ts)", () => {
  it("lists registry models only, with unique labelled options and a default that exists", () => {
    const registryIds = MODELS.map((m) => m.id);
    for (const [id, entry] of Object.entries(CHAT_REASONING_OPTIONS)) {
      expect(registryIds, id).toContain(id);
      const ids = entry.options.map((o) => o.id);
      expect(new Set(ids).size, id).toBe(ids.length);
      expect(ids, id).toContain(entry.defaultId);
      for (const o of entry.options) expect(o.label.trim(), `${id}/${o.id}`).not.toBe("");
    }
    // No reasoning control on models without one.
    for (const id of ["mistral-large-2512", "deepseek-v4-flash"]) expect(CHAT_REASONING_OPTIONS[id]).toBeUndefined();
  });

  it("GLM 5.3 offers low / high / max with high as the default (max is its deep-reasoning level)", () => {
    expect(CHAT_REASONING_OPTIONS["zai-glm-5-3"].options.map((o) => o.id)).toEqual(["low", "high", "max"]);
    expect(CHAT_REASONING_OPTIONS["zai-glm-5-3"].defaultId).toBe("high");
  });

  it("the level in force is the stored choice when valid, else the default, and null without a control", () => {
    expect(effectiveReasoningId("zai-glm-5-3", { "zai-glm-5-3": "max" })).toBe("max");
    expect(effectiveReasoningId("zai-glm-5-3", { "zai-glm-5-3": "turbo" })).toBe("high");
    expect(effectiveReasoningId("zai-glm-5-3", undefined)).toBe("high");
    expect(effectiveReasoningId("claude-sonnet-4-6", { "zai-glm-5-3": "max" })).toBe("off");
    expect(effectiveReasoningId("mistral-large-2512", { "mistral-large-2512": "high" })).toBeNull();

    expect(reasoningLabelFor("zai-glm-5-3", { "zai-glm-5-3": "max" })).toBe("Max (slow)");
    expect(reasoningLabelFor("claude-opus-4-8", {})).toBe("High");
    expect(reasoningLabelFor("deepseek-v4-flash", {})).toBeNull();
  });
});
