import { Component, ReactNode, ErrorInfo } from "react";
import { Button } from "@/components/ui/button";
import { AlertCircle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  onRetry?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error boundary around the live provenance panel.
 *
 * The walker in FlowHighlightedText can throw on edge-case content shapes
 * (e.g. after multi-node AI insertions introduce block nodes the walker's
 * position arithmetic hasn't been validated against). Without this boundary,
 * a render throw blanks the entire subtree and the user has to refresh the
 * whole page to recover.
 *
 * Keep this boundary in place even after underlying walker fixes ship —
 * defense in depth.
 */
export class ProvenanceErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ProvenanceErrorBoundary] Provenance panel crashed", {
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
    });
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
    this.props.onRetry?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col h-full items-center justify-center gap-3 p-6 text-center bg-background">
          <AlertCircle className="h-6 w-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground max-w-xs">
            Provenance display temporarily unavailable.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={this.handleRetry}
          >
            <RefreshCw className="h-3 w-3" />
            Retry
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
