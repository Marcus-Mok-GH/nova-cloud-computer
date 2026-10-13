import { cn } from "@/lib/utils";
import { AlertTriangle, Copy, Check, RotateCcw } from "lucide-react";
import { Component, ReactNode, useEffect, useRef, useState } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  componentStack: string | null;
}

/** Copies the crash detail to the clipboard with a brief confirmation. */
function CopyErrorButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    []
  );
  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Clipboard API is unavailable (non-secure context, older
        // browsers): fall back to a temporary selection.
        const area = document.createElement("textarea");
        area.value = text;
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        document.body.removeChild(area);
      }
      setCopied(true);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable - the detail above stays visible for manual copy */
    }
  };
  return (
    <button
      onClick={copy}
      className={cn(
        "mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium",
        "border border-border bg-background text-muted-foreground",
        "hover:text-foreground cursor-pointer"
      )}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
      {copied ? "Copied" : "Copy error"}
    </button>
  );
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, componentStack: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, componentStack: null };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    // The full error is also logged to the developer console. The fallback
    // below shows the error detail on screen so a crash can be reported.
    console.error("[Nova] UI error:", error);
    if (info?.componentStack) {
      this.setState({ componentStack: info.componentStack });
    }
  }

  render() {
    if (this.state.hasError) {
      const { error, componentStack } = this.state;
      const detail = error
        ? `${error.name}: ${error.message}${
            error.stack ? `\n${error.stack}` : ""
          }${componentStack ? `\n${componentStack}` : ""}`
        : "Unknown error";
      return (
        <div className="flex items-center justify-center min-h-dvh p-8 bg-background">
          <div className="flex flex-col items-center w-full max-w-2xl p-8">
            <AlertTriangle
              size={48}
              className="text-destructive mb-6 flex-shrink-0"
            />

            <h2 className="text-xl mb-4">An unexpected error occurred.</h2>

            <div className="p-4 w-full rounded bg-muted mb-6">
              <p className="text-sm text-muted-foreground">
                Nova hit an unexpected problem on this page. Your workspace
                data is safe - reload to try again.
              </p>
              <details className="mt-3">
                <summary className="cursor-pointer text-xs font-semibold text-muted-foreground hover:text-foreground">
                  Error details
                </summary>
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-background p-3 font-mono text-xs leading-5 text-foreground">
                  {detail}
                </pre>
                <CopyErrorButton text={detail} />
              </details>
            </div>

            <button
              onClick={() => window.location.reload()}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg",
                "bg-primary text-primary-foreground",
                "hover:opacity-90 cursor-pointer"
              )}
            >
              <RotateCcw size={16} />
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
