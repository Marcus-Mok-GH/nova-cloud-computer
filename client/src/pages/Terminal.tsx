import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { MonitorSmartphone, RefreshCw, SquareTerminal, XCircle } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

/**
 * Direct terminal access to the workspace's agent VM. The shell lives in the
 * persistent E2B sandbox; this tab attaches to it: typed keys are forwarded as
 * PTY input and new output is polled at a short interval. Closing the tab
 * keeps the session alive on the server so it can be reattached.
 */

const READ_INTERVAL_MS = 250;

export default function Terminal() {
  const computer = trpc.workspace.computer.useQuery(undefined, { retry: false });
  const utils = trpc.useUtils();
  const status = trpc.terminal.status.useQuery(undefined, { retry: false, refetchInterval: 5000, refetchOnWindowFocus: false, refetchIntervalInBackground: false });
  const startTerminal = trpc.terminal.start.useMutation({ onError: e => toast.error(e.message) });
  const writeTerminal = trpc.terminal.write.useMutation({ onError: e => toast.error(e.message) });
  const resizeTerminal = trpc.terminal.resize.useMutation();
  const stopTerminal = trpc.terminal.stop.useMutation({
    onSuccess: async () => { termRef.current?.reset(); await utils.terminal.status.invalidate(); toast.success("Terminal closed"); },
    onError: e => toast.error(e.message),
  });

  const shellRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const seqRef = useRef(0);
  const aliveRef = useRef(false);
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [attached, setAttached] = useState(false);

  const start = async (reused: boolean) => {
    if (!termRef.current || !fitRef.current) return;
    const fit = fitRef.current;
    fit.fit();
    try {
      const result = await startTerminal.mutateAsync({ cols: termRef.current.cols, rows: termRef.current.rows });
      termRef.current.reset();
      seqRef.current = result.seq;
      termRef.current.write(result.output);
      if (!reused) toast.success("Terminal connected to your agent VM");
      setAttached(true);
      termRef.current.focus();
    } catch {
      setAttached(false);
    }
  };

  // Mount the terminal once; polling and key forwarding stay attached to its
  // session so reopening the tab shows the retained scrollback.
  useEffect(() => {
    const host = shellRef.current;
    if (!host) return;
    const term = new XTerm({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
      scrollback: 5000,
      convertEol: false,
      theme: { background: "#101014" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    term.onData(data => {
      if (!aliveRef.current) return;
      writeTerminal.mutate({ data });
    });

    const observer = new ResizeObserver(() => {
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
      resizeTimerRef.current = setTimeout(() => {
        if (!termRef.current || !fitRef.current) return;
        try { fitRef.current.fit(); } catch { return; }
        if (aliveRef.current) resizeTerminal.mutate({ cols: termRef.current.cols, rows: termRef.current.rows });
      }, 150);
    });
    observer.observe(host);

    return () => {
      observer.disconnect();
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll for new PTY output while a session is attached.
  useEffect(() => {
    if (!attached) return;
    aliveRef.current = true;
    let cancelled = false;
    const tick = async () => {
      if (cancelled || document.hidden) return;
      try {
        const result = await utils.terminal.read.fetch({ sinceSeq: seqRef.current });
        if (result.active && (result.data || result.reset)) {
          if (result.reset) termRef.current?.reset();
          termRef.current?.write(result.data);
          seqRef.current = result.seq;
        } else if (!result.active) {
          aliveRef.current = false;
          setAttached(false);
          termRef.current?.write("\r\n\x1b[33m[the terminal session ended]\x1b[0m\r\n");
        }
      } catch { /* transient poll failures are retried on the next tick */ }
    };
    const interval = setInterval(tick, READ_INTERVAL_MS);
    void tick();
    return () => { cancelled = true; aliveRef.current = false; clearInterval(interval); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attached]);

  // Reattach automatically when the server reports a live session.
  useEffect(() => {
    if (attached || startTerminal.isPending) return;
    if (status.data?.active) void start(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.data?.active]);

  const closeTerminal = () => {
    if (!window.confirm("Close the terminal session? Files created in this session are imported into your Files.")) return;
    aliveRef.current = false;
    setAttached(false);
    seqRef.current = 0;
    stopTerminal.mutate(undefined);
  };

  if (computer.isError) {
    return (
      <DashboardLayout>
        <div className="p-6"><p className="text-sm text-muted-foreground">Your Nova workspace could not be reached. Please refresh the page.</p></div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-4 p-4 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold"><SquareTerminal className="size-5 text-orange-500" aria-hidden /> Terminal</h1>
            <p className="text-sm text-muted-foreground">A live shell in your agent VM - the same sandbox Nova works in.</p>
          </div>
          <div className="flex items-center gap-2">
            {status.data?.active ? (
              <>
                <Button variant="outline" size="sm" onClick={() => start(true)} disabled={startTerminal.isPending || attached}><RefreshCw className="size-4" aria-hidden /> Reattach</Button>
                <Button variant="outline" size="sm" onClick={closeTerminal} disabled={stopTerminal.isPending}><XCircle className="size-4" aria-hidden /> Close session</Button>
              </>
            ) : (
              <Button size="sm" onClick={() => start(false)} disabled={startTerminal.isPending || attached}><MonitorSmartphone className="size-4" aria-hidden /> Connect to agent VM</Button>
            )}
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Changes you make here stay in the live sandbox. Closing the session imports new files into Files; agent runs may restore the workspace from Files.
        </p>

        <div
          ref={shellRef}
          data-testid="terminal-shell"
          aria-label="Agent VM terminal"
          className="min-h-[60vh] overflow-hidden rounded-xl border border-border bg-[#101014] p-2"
          onClick={() => termRef.current?.focus()}
        />
      </div>
    </DashboardLayout>
  );
}
