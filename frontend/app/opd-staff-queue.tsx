import type { User } from "firebase/auth";
import { useEffect, useState } from "react";
import { calledTime } from "./opd-time";

type QueueToken = { tokenNumber: number; status: "Waiting" | "Called"; calledAt: string | null };
type CallResult =
  | { empty: true; token: null }
  | { empty: false; token: QueueToken & { opdDate: string } };

export function OpdStaffQueue({ user, apiUrl }: { user: User; apiUrl: string }) {
  const [queue, setQueue] = useState<QueueToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [calling, setCalling] = useState(false);
  const [message, setMessage] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    async function loadQueue() {
      try {
        const token = await user.getIdToken();
        const response = await fetch(`${apiUrl}/api/opd/queue`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Queue request failed");
        const items: QueueToken[] = await response.json();
        if (!controller.signal.aborted) setQueue(items);
      } catch {
        if (!controller.signal.aborted) setLoadError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void loadQueue();
    return () => controller.abort();
  }, [apiUrl, user, revision]);

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
      setLoading(true);
      setLoadError(false);
      setRevision((value) => value + 1);
    } catch {
      setMessage("Could not confirm the call. Select Call next to retry.");
    } finally {
      setCalling(false);
    }
  }

  // Tokens can only be called in ascending order.
  const lastCalled = queue.findLast((item) => item.status === "Called");

  return (
    <section aria-labelledby="staff-queue">
      <h2 id="staff-queue">Today’s OPD queue</h2>
      <button type="button" disabled={calling || loading} onClick={callNext}>Call next</button>
      {message && <p role="status">{message}</p>}
      {loading ? <p role="status">Loading queue…</p> : loadError ? (
        <p role="status">Could not load the queue. Refresh the page to try again.</p>
      ) : (
        <>
          <p>{lastCalled ? `Last called token: ${lastCalled.tokenNumber}` : "No tokens called today."}</p>
          {queue.length === 0 ? <p>No tokens booked today.</p> : (
            <table>
              <thead><tr><th scope="col">Token</th><th scope="col">Status</th><th scope="col">Called time</th></tr></thead>
              <tbody>
                {queue.map((item) => (
                  <tr key={item.tokenNumber}>
                    <td>{item.tokenNumber}</td>
                    <td>{item.status}</td>
                    <td>{item.calledAt && <time dateTime={item.calledAt}>{calledTime.format(new Date(item.calledAt))}</time>}</td>
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
