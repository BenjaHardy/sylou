// The activity box on owner and shared FLOW reports: the three numbers, and
// the info icon that says how they are recorded.
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { MetricsSnapshot } from "@/hooks/useFlowAnalysis";
import { ProjectActivitySection } from "../ProjectActivitySection";

const metrics: MetricsSnapshot = {
  total_active_time_seconds: 3 * 3600 + 25 * 60 + 10,
  total_writing_time_seconds: 47 * 60 + 59,
  chat_prompt_count_normal: 4,
  chat_prompt_count_tutor: 3,
  sanity_check_count: 0,
  first_activity_at: null,
  last_activity_at: null,
  clock_anomaly_count: 0,
};

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});

describe("ProjectActivitySection", () => {
  it("shows active time, writing time and the prompt total", () => {
    render(<ProjectActivitySection metrics={metrics} />);
    expect(screen.getByText("3h 25m")).toBeInTheDocument();
    expect(screen.getByText("47m")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("explains how the activity is recorded", async () => {
    render(<ProjectActivitySection metrics={metrics} />);
    fireEvent.focus(screen.getByLabelText("How activity is counted"));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Recorded by Sylou while the project was open and in use.",
    );
  });
});
