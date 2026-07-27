import { Component, type ReactNode, type ErrorInfo } from "react";

/** Error boundary for the provenance-highlighted text overlay. Extracted
 *  from FlowReportView so the public SharedReport page can reuse it
 *  without importing the whole authoring view (keeps the share-page
 *  bundle chunk small — P4-3 split). */
export class HighlightedTextErrorBoundary extends Component<
  { children: ReactNode; onClose: () => void },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[FlowHighlightedText crash]", error, info.componentStack);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="absolute inset-0 z-10 bg-background flex flex-col items-center justify-center gap-4">
          <p className="text-muted-foreground">Something went wrong rendering the highlighted text.</p>
          <button
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm"
            onClick={this.props.onClose}
          >
            Back to Report
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
