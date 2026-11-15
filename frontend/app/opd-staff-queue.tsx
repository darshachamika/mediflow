import type { User } from "firebase/auth";
import { useEffect, useRef, useState } from "react";
import { calledTime, todayOpdDate } from "./opd-time";
import { OpdDatePicker } from "./opd-date-picker";

type QueueToken = {
  id: number;
  tokenNumber: number;
  status: "Booked" | "Waiting" | "Called" | "Completed" | "Cancelled";
  calledAt: string | null;
  completedAt: string | null;
};
type CallResult =
  | { empty: true; token: null }
  | { empty: false; token: { tokenNumber: number; opdDate: string } };
type QueueSnapshot = { date: string; rows: QueueToken[] };

export function OpdStaffQueue({ user, apiUrl }: { user: User; apiUrl: string }) {
  const [snapshot, setSnapshot] = useState<QueueSnapshot | null>(null);
  const [failedDate, setFailedDate] = useState<string | null>(null);
  const [calling, setCalling] = useState(false);
  const [completing, setCompleting] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const refreshAfterAction = useRef<(() => void) | null>(null);
  const [statusFilter, setStatusFilter] = useState<"All" | QueueToken["status"]>("All");
  const [tokenSearch, setTokenSearch] = useState("");
  const [historyDate, setHistoryDate] = useState<string | null>(null);
  const abortQueue = useRef<AbortController | null>(null);
  const today = todayOpdDate();
  const viewingToday = historyDate === null;
  const selectedDate = historyDate ?? today;

  useEffect(() => {
    const controller = new AbortController();
    abortQueue.current = controller;
    const { signal } = controller;
    let inFlight = false;
    let refreshPending = false;
    let revision = 0;

    async function loadQueue(queueIfBusy = false) {
      if (signal.aborted || (historyDate === null && document.visibilityState !== "visible")) return;
      if (inFlight) {
        refreshPending ||= queueIfBusy;
        return;
      }

      inFlight = true;
      const requestRevision = revision;
      try {
        const token = await user.getIdToken();
        if (signal.aborted) return;
        const query = `?date=${encodeURIComponent(selectedDate)}`;
        const response = await fetch(`${apiUrl}/api/opd/queue${query}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
          signal,
        });
        if (!response.ok) throw new Error("Queue request failed");
        if (response.headers.get("X-Opd-Date") !== selectedDate) {
          throw new Error("Queue response date does not match the requested date");
        }
        const items: QueueToken[] = await response.json();
        if (!signal.aborted && requestRevision === revision) {
          setSnapshot({ date: selectedDate, rows: items });
          setFailedDate(null);
        }
      } catch {
        if (!signal.aborted && requestRevision === revision) setFailedDate(selectedDate);
      } finally {
        inFlight = false;
        if (refreshPending) {
          refreshPending = false;
          void loadQueue();
        }
      }
    }

    function refreshWhenVisible() {
      void loadQueue(true);
    }

    refreshAfterAction.current = () => {
      // Any read already in progress may reflect the queue before the action.
      revision++;
      void loadQueue(true);
    };
    void loadQueue();
    const interval = historyDate === null ? window.setInterval(() => void loadQueue(), 10_000) : undefined;
    if (historyDate === null) document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      refreshAfterAction.current = null;
      abortQueue.current = null;
    };
  }, [apiUrl, user, historyDate, selectedDate]);

  const actionPending = calling || completing !== null;

  function selectDate(date: string) {
    const nextDate = date === today ? null : date;
    abortQueue.current?.abort();
    setHistoryDate(nextDate);
    setSnapshot(null);
    setFailedDate(null);
    setMessage("");
  }

  async function callNext() {
    setCalling(true);
    setMessage("");
    try {
      const pendingKey = `mediflow:opd-call:${apiUrl}:${user.uid}`;
      const key = sessionStorage.getItem(pendingKey) ?? crypto.randomUUID();
      sessionStorage.setItem(pendingKey, key);
      const token = await user.getIdToken();
      const response = await fetch(`${apiUrl}/api/opd/queue/call-next`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": key },
      });
      if (!response.ok) throw new Error("Call request failed");
      const result: CallResult = await response.json();
      sessionStorage.removeItem(pendingKey);
      setMessage(result.empty ? "No tokens are waiting." : `Called token ${result.token.tokenNumber} for ${result.token.opdDate}.`);
      refreshAfterAction.current?.();
    } catch {
      setMessage("Could not confirm the call. Select Call next to retry.");
    } finally {
      setCalling(false);
    }
  }

  async function complete(item: QueueToken) {
    setCompleting(item.id);
    setMessage("");
    try {
      const token = await user.getIdToken();
      const response = await fetch(`${apiUrl}/api/opd/queue/${item.id}/complete`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const details = await response.json().catch(() => null);
        setMessage(details?.error ?? `Could not complete token ${item.tokenNumber} (HTTP ${response.status}).`);
        return;
      }
      refreshAfterAction.current?.();
    } catch {
      setMessage(`Could not confirm completion for token ${item.tokenNumber}. Select Complete to retry.`);
    } finally {
      setCompleting(null);
    }
  }

  const loadedQueue = snapshot?.date === selectedDate ? snapshot.rows : null;
  const loadError = failedDate === selectedDate;
  const queue = loadedQueue ?? [];
  const loading = loadedQueue === null && !loadError;
  // Completed tokens still count toward the call history.
  const lastCalled = queue.findLast((item) => item.calledAt !== null);
  const counts = { Booked: 0, Waiting: 0, Called: 0, Completed: 0, Cancelled: 0 };
  for (const item of queue) {
    counts[item.status]++;
  }
  const searchedToken = tokenSearch.trim();
  const visibleRows = queue.filter((item) =>
    (statusFilter === "All" || item.status === statusFilter)
    && (searchedToken === "" || String(item.tokenNumber) === searchedToken));

  return (
    <section aria-labelledby="staff-queue">
      <h2 id="staff-queue">{viewingToday ? "Today’s OPD queue" : `OPD queue for ${historyDate}`}</h2>
      <OpdDatePicker date={selectedDate} today={today} disabled={actionPending} onSelect={selectDate} />
      {viewingToday && <button type="button" disabled={actionPending || loading} onClick={callNext}>Call next</button>}
      {message && <p role="status">{message}</p>}
      {loading && <p role="status">Loading queue…</p>}
      {loadError && <p role="status">{loadedQueue === null
        ? viewingToday ? "Could not load the queue. The page will retry automatically."
          : "Could not load the queue for this date. Refresh the page or select another date."
        : "Could not refresh the queue. Showing the last update."}</p>}
      {loadedQueue !== null && (
        <>
          <p>{lastCalled ? `Last called token: ${lastCalled.tokenNumber}` : "No tokens called for this date."}</p>
          <dl aria-label="Queue status counts">
            {Object.entries(counts).map(([status, count]) => (
              <div key={status}>
                <dt>{status}</dt>
                <dd>{count}</dd>
              </div>
            ))}
          </dl>
          <label>
            Status{" "}
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
              <option>All</option>
              {Object.keys(counts).map((status) => <option key={status}>{status}</option>)}
            </select>
          </label>
          <label>
            Token number{" "}
            <input type="search" inputMode="numeric" value={tokenSearch}
              onChange={(event) => setTokenSearch(event.target.value)} />
          </label>
          {visibleRows.length === 0 ? (
            <p>{queue.length === 0
              ? "No tokens booked for this date."
              : "No tokens match the current search and status filter."}</p>
          ) : (
            <table>
              <thead><tr><th scope="col">Token</th><th scope="col">Status</th><th scope="col">Called time</th>{viewingToday && <th scope="col">Action</th>}</tr></thead>
              <tbody>
                {visibleRows.map((item) => (
                  <tr key={item.id}>
                    <td>{item.tokenNumber}</td>
                    <td>{item.status}</td>
                    <td>{item.calledAt && <time dateTime={item.calledAt}>{calledTime.format(new Date(item.calledAt))}</time>}</td>
                    {viewingToday && <td>{item.status === "Called" && (
                      <button type="button" disabled={calling || completing !== null}
                        aria-label={`Complete token ${item.tokenNumber}`} onClick={() => void complete(item)}>
                        {completing === item.id ? "Completing…" : "Complete"}
                      </button>
                    )}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}
