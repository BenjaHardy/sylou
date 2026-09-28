// Registry sanity tests for the frontend model registry (P4-5) —
// the client-side mirror of the edge functions' _shared/_models checks.
import { describe, it, expect } from "vitest";
import {
  DEFAULT_CHAT_MODEL,
  DEFAULT_FLOW_MODEL,
  FLOW_OTHER_GROUP_ID,
  FLOW_RECOMMENDED_GROUP_ID,
  MODELS,
  PROVIDER_LABELS,
  groupModelsByProvider,
  groupModelsForFlow,
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

  it("exactly two models are recommended for FLOW: GLM 5.2 and Claude Sonnet 4.6 (maintainer rulings 2026-07 + 2026-09)", () => {
    const recommended = MODELS.filter((m) => m.flowRecommended);
    expect(recommended.map((m) => m.id)).toEqual(["zai-glm-5-2", "claude-sonnet-4-6"]);
  });

  it("no recommended model carries the experimental badge", () => {
    for (const m of MODELS) {
      if (m.flowRecommended) expect(m.isExperimental, m.id).toBeFalsy();
    }
  });

  it("the recommendation lives in the flag, not in note wording (the FLOW group conveys it)", () => {
    for (const m of MODELS) expect(m.note ?? "", m.id).not.toMatch(/recommended/i);
  });

  it("the defaults for new profiles are GLM 5.2 (maintainer decision 2026-09-25) and exist in the registry", () => {
    expect(DEFAULT_CHAT_MODEL).toBe("zai-glm-5-2");
    expect(DEFAULT_FLOW_MODEL).toBe("zai-glm-5-2");
    expect(MODELS.map((m) => m.id)).toContain(DEFAULT_CHAT_MODEL);
    expect(MODELS.find((m) => m.id === DEFAULT_FLOW_MODEL)?.flowRecommended).toBe(true);
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
      "zai-glm-5-2",
    ]);
    expect(ids(groups[2].models)).toEqual(["deepseek-v4-flash"]);
  });

  it("FLOW: recommended first, everything else in the second group", () => {
    const groups = groupModelsForFlow();
    expect(groups.map((g) => g.id)).toEqual([FLOW_RECOMMENDED_GROUP_ID, FLOW_OTHER_GROUP_ID]);
    expect(ids(groups[0].models)).toEqual(["zai-glm-5-2", "claude-sonnet-4-6"]);
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
