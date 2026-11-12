import { useCallback, useRef } from "react";
import { EmailList } from "./EmailList";
import { ReadingPane } from "./ReadingPane";
import { useUIStore } from "@/stores/uiStore";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { useAccountStore } from "@/stores/accountStore";

function ResizableEmailLayout() {
  const emailListWidth = useUIStore((s) => s.emailListWidth);
  const setEmailListWidth = useUIStore((s) => s.setEmailListWidth);
  const syncStatus = useUIStore((s) => s.syncStatus);
  const accounts = useAccountStore((s) => s.accounts);
  const hasActiveAccounts = accounts.some((a) => a.isActive);
  const isSyncing = hasActiveAccounts && syncStatus !== null && !syncStatus.startsWith("Sync failed") && syncStatus !== "Sync complete";
  const containerRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = listRef.current?.offsetWidth ?? emailListWidth;

    const handleMouseMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      const newWidth = Math.min(800, Math.max(240, startWidth + delta));
      if (listRef.current) listRef.current.style.width = `${newWidth}px`;
    };

    const handleMouseUp = (ev: MouseEvent) => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      const delta = ev.clientX - startX;
      const finalWidth = Math.min(800, Math.max(240, startWidth + delta));
      setEmailListWidth(finalWidth);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [emailListWidth, setEmailListWidth]);

  return (
    <div ref={containerRef} className="flex flex-1 min-w-0 flex-col overflow-hidden">
      <div className="flex flex-1 min-w-0 flex-row overflow-hidden">
        <EmailList width={emailListWidth} listRef={listRef} />
        <div
          onMouseDown={handleMouseDown}
          className="w-1 cursor-col-resize bg-border-primary hover:bg-accent/50 active:bg-accent transition-colors shrink-0"
        />
        <ReadingPane />
      </div>
      {isSyncing && (
        <div className="flex items-center justify-center gap-2 py-1.5 border-t border-border-primary/50">
          <div className="relative w-3.5 h-3.5">
            <div className="absolute inset-0 rounded-full border border-accent/30" />
            <div className="absolute inset-0 rounded-full border border-transparent border-t-accent animate-spin" />
          </div>
          <span className="text-xs text-text-tertiary">{syncStatus}</span>
        </div>
      )}
    </div>
  );
}

export function MailLayout() {
  const readingPanePosition = useUIStore((s) => s.readingPanePosition);
  const syncStatus = useUIStore((s) => s.syncStatus);
  const accounts = useAccountStore((s) => s.accounts);
  const hasActiveAccounts = accounts.some((a) => a.isActive);
  const isSyncing = hasActiveAccounts && syncStatus !== null && !syncStatus.startsWith("Sync failed") && syncStatus !== "Sync complete";

  if (readingPanePosition === "right") {
    return (
      <ErrorBoundary name="EmailLayout">
        <ResizableEmailLayout />
      </ErrorBoundary>
    );
  }

  return (
    <div className={`flex flex-1 min-w-0 flex-col overflow-hidden`}>
      <div className={`flex flex-1 min-w-0 ${readingPanePosition === "bottom" ? "flex-col" : "flex-row"}`}>
        <ErrorBoundary name="EmailList">
          <EmailList />
        </ErrorBoundary>
        {readingPanePosition !== "hidden" && (
          <ErrorBoundary name="ReadingPane">
            <ReadingPane />
          </ErrorBoundary>
        )}
      </div>
      {isSyncing && (
        <div className="flex items-center justify-center gap-2 py-1.5 border-t border-border-primary/50">
          <div className="relative w-3.5 h-3.5">
            <div className="absolute inset-0 rounded-full border border-accent/30" />
            <div className="absolute inset-0 rounded-full border border-transparent border-t-accent animate-spin" />
          </div>
          <span className="text-xs text-text-tertiary">{syncStatus}</span>
        </div>
      )}
    </div>
  );
}
