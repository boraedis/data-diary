"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { InconsistencyStatus } from "@/db/schema";

/**
 * The review page's two client pieces (#672). Both write through the API
 * and then `router.refresh()` the server-rendered list, rather than keeping
 * their own copy of it: the page's counts and groups are server-computed,
 * and refreshing keeps them honest after any change.
 */

async function send(url: string, init: RequestInit): Promise<string | null> {
  try {
    const res = await fetch(url, init);
    if (res.ok) return null;
    const body = await res.json().catch(() => null);
    return typeof body?.error === "string" ? body.error : "Request failed";
  } catch {
    return "Network error";
  }
}

// What each list offers: open findings can be dismissed or marked
// resolved; a dismissed or resolved one can only be reopened (the undo).
const ACTIONS: Record<InconsistencyStatus, { to: InconsistencyStatus; label: string }[]> = {
  open: [
    { to: "resolved", label: "Fixed" },
    { to: "dismissed", label: "Dismiss" },
  ],
  dismissed: [{ to: "open", label: "Reopen" }],
  resolved: [{ to: "open", label: "Reopen" }],
};

export function FindingActions({ id, status }: { id: number; status: InconsistencyStatus }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function move(to: InconsistencyStatus) {
    setPending(true);
    setError(null);
    const failure = await send(`/api/inconsistencies/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: to }),
    });
    if (failure) {
      setError(failure);
      setPending(false);
      return;
    }
    // Left pending: the row leaves this list once the refresh lands.
    router.refresh();
  }

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
      {ACTIONS[status].map((a) => (
        <Button
          key={a.to}
          type="button"
          size="xs"
          variant={a.to === "dismissed" ? "ghost" : "outline"}
          disabled={pending}
          onClick={() => move(a.to)}
        >
          {a.label}
        </Button>
      ))}
    </div>
  );
}

export function RunScanButton() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setMessage(null);
    try {
      const res = await fetch("/api/inconsistencies/scan", { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setMessage(typeof body?.error === "string" ? body.error : "Scan failed");
        return;
      }
      setMessage(`${body.added} new, ${body.resolved} resolved`);
      router.refresh();
    } catch {
      setMessage("Network error");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {message ? <span className="text-xs text-muted-foreground">{message}</span> : null}
      <Button type="button" size="sm" variant="outline" disabled={running} onClick={run}>
        {running ? "Scanning…" : "Run scan now"}
      </Button>
    </div>
  );
}
