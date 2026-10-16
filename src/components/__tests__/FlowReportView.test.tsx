// Behaviour pins for the FLOW report view rendered from a fixture report:
// the loading and empty states, band labels (never raw scores), the Report
// ID and share controls, the frozen writing snapshot on the Writing tab and
// behind "View Highlighted Text" (paired with the frozen provenance map, not
// any live writing), and the per-pillar reasoning disclosure.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FlowReport } from "@/hooks/useFlowAnalysis";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: { replay_snapshot: null }, error: null }) }) }),
    }),
  },
}));
// The pledge badge draws on a canvas, which jsdom does not implement.
vi.mock("@/components/flow-report/FlowPledgeBadge", () => ({ FlowPledgeBadge: () => null }));

import { FlowReportView } from "@/components/FlowReportView";
import { getBandLabel } from "@/lib/flowBands";

const pillar = (score: number, reasoning: string) => ({
  score,
  reasoning,
  evidence: [`Evidence for ${reasoning}`],
  narrative: `Narrative for ${reasoning}`,
});

// "<p>Frozen text written</p>": p(1) + 19 chars + p(1). "text" sits at 8–12.
const FROZEN_HTML = "<p>Frozen text written</p>";
const FROZEN_SEGMENTS = [
  { start: 0, end: 8, source: "typed" as const },
  { start: 8, end: 12, source: "ai_editor" as const },
  { start: 12, end: 21, source: "typed" as const },
];

const SCORES = { find: 3.7, lead: 2.2, organize: 4.1, write: 1.3 };

function makeReport(over: Partial<FlowReport> = {}): FlowReport {
  return {
    id: "r-1",
    project_id: "p-1",
    ai_summary: "Overall summary of the process.",
    ai_find: pillar(SCORES.find, "Find reasoning."),
    ai_lead: pillar(SCORES.lead, "Lead reasoning."),
    ai_organize: pillar(SCORES.organize, "Organize reasoning."),
    ai_write: pillar(SCORES.write, "Write reasoning."),
    key_user_contributions: [
      { contribution: "Outlined the argument", evidence: "The outline", why_it_matters: "Direction" },
    ],
    flow_meta: null,
    metrics_snapshot: null,
    provenance_snapshot: FROZEN_SEGMENTS,
    model_used: "zai-glm-5-3",
    created_at: "2026-10-13T10:00:00.000Z",
    user_feedback_pre: null,
    user_feedback_pre_at: null,
    user_feedback_post: null,
    user_feedback_post_at: null,
    share_token: "tok-1",
    share_enabled: true,
    certificate_id: "FLOW-ABCDEFGH",
    writing_snapshot: FROZEN_HTML,
    ...over,
  };
}

function renderView(report: FlowReport | null, over: Partial<Parameters<typeof FlowReportView>[0]> = {}) {
  const props = {
    report,
    projectName: "Test project",
    loading: false,
    onBack: vi.fn(),
    onSaveFeedback: vi.fn(),
    onSaveAssessment: vi.fn(),
    showPreAnalysis: false,
    ...over,
  };
  return { ...render(<FlowReportView {...props} />), props };
}

const button = (name: RegExp | string) => screen.getByRole("button", { name });

beforeAll(() => {
  // jsdom implements neither layout observers nor programmatic scrolling.
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  window.scrollTo = vi.fn();
  Element.prototype.scrollTo = vi.fn();
});

beforeEach(() => {
  invokeMock.mockReset();
});

describe("FlowReportView", () => {
  it("shows the analysing state while loading and a notice when there is no report", () => {
    const first = renderView(null, { loading: true });
    expect(screen.getByText("Analyzing your project…")).toBeInTheDocument();
    first.unmount();

    renderView(null);
    expect(screen.getByText("No report data available.")).toBeInTheDocument();
    expect(button("Back to Editor")).toBeInTheDocument();
  });

  it("shows each pillar's band label and never a raw score", () => {
    renderView(makeReport());

    for (const score of Object.values(SCORES)) {
      expect(screen.getAllByText(getBandLabel(score)).length).toBeGreaterThan(0);
    }
    const text = document.body.textContent ?? "";
    for (const score of Object.values(SCORES)) {
      expect(text).not.toMatch(new RegExp(`\\b${String(score).replace(".", "\\.")}\\b`));
    }
    expect(screen.getByText("Overall summary of the process.")).toBeInTheDocument();
    expect(screen.getByText("Outlined the argument")).toBeInTheDocument();
  });

  it("Explain this assessment reveals the pillar's reasoning", () => {
    renderView(makeReport());
    expect(screen.queryByText("Find reasoning.")).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Explain this assessment" })[0]);
    expect(screen.getByText("Find reasoning.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide reasoning" })).toBeInTheDocument();
  });

  it("a shared report shows its Report ID; the switch toggles sharing through the share-report function", async () => {
    invokeMock.mockResolvedValue({ data: null, error: null });
    renderView(makeReport());

    expect(screen.getByText("FLOW Report ID #FLOW-ABCDEFGH")).toBeInTheDocument();
    expect(screen.getByText("Sharing enabled")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("share-report", {
        body: { report_id: "r-1", action: "toggle", share_enabled: false },
      }),
    );
  });

  it("an unshared report offers to generate a link; the function's answer becomes the Report ID", async () => {
    invokeMock.mockResolvedValue({ data: { share_token: "tok-new", certificate_id: "FLOW-NEWREPORT" }, error: null });
    renderView(makeReport({ share_token: null, share_enabled: false, certificate_id: null }));

    expect(screen.queryByText(/FLOW Report ID #/)).not.toBeInTheDocument();
    fireEvent.click(button("Generate Share Link"));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("share-report", { body: { report_id: "r-1" } }));
    expect(await screen.findByText("FLOW Report ID #FLOW-NEWREPORT")).toBeInTheDocument();
  });

  it("the Writing tab shows the frozen snapshot, not anything live", () => {
    renderView(makeReport());
    expect(screen.queryByText("Frozen text written")).not.toBeInTheDocument();

    fireEvent.click(button("Writing"));
    expect(screen.getByText("Writing snapshot")).toBeInTheDocument();
    expect(screen.getByText("Frozen text written")).toBeInTheDocument();
  });

  it("View Highlighted Text pairs the frozen snapshot with the frozen provenance map", () => {
    renderView(makeReport());

    fireEvent.click(button("View Highlighted Text"));
    expect(screen.getByText("Text Provenance")).toBeInTheDocument();

    const annotated = document.querySelector(".font-mono") as HTMLElement;
    expect(annotated.textContent).toBe("Frozen text written");
    const aiSpans = Array.from(annotated.querySelectorAll("span")).filter((s) => s.className.includes("bg-blue-200/60"));
    expect(aiSpans.map((s) => s.textContent).join("")).toBe("text");

    // The close button is the only button in the panel header.
    const header = screen.getByText("Text Provenance").parentElement as HTMLElement;
    fireEvent.click(within(header).getByRole("button"));
    expect(screen.queryByText("Text Provenance")).not.toBeInTheDocument();
  });

  it("without a provenance map the highlighted view is not offered", () => {
    renderView(makeReport({ provenance_snapshot: null }));
    expect(screen.queryByRole("button", { name: "View Highlighted Text" })).not.toBeInTheDocument();
  });

  it("the Collaboration Style tab names the model that produced the report", () => {
    renderView(makeReport());
    fireEvent.click(button("FLOW Collaboration Style"));
    expect(screen.getByText(/Model: Z\.ai GLM 5\.3 \(via Mistral\)/)).toBeInTheDocument();
    expect(screen.getByText("Project: Test project")).toBeInTheDocument();
  });
});
