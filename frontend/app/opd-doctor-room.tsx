import type { User } from "firebase/auth";
import { useEffect, useState } from "react";
import { opdRequest } from "./opd-request";

type Room = { id: number; name: string; opdDate: string };
type ActiveToken = { id: number; tokenNumber: number; status: "Called" | "InConsultation" };

export function OpdDoctorRoom({ user, apiUrl }: { user: User; apiUrl: string }) {
  const [room, setRoom] = useState<Room | null>(null);
  const [active, setActive] = useState<ActiveToken | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    async function load() {
      try {
        const { room } = await opdRequest<{ room: Room | null }>(user, apiUrl, "/api/opd/rooms/assigned", { signal });
        const snapshot = room
          ? await opdRequest<{ activeToken: ActiveToken | null }>(user, apiUrl, `/api/opd/rooms/${room.id}`, { signal })
          : null;
        if (!signal.aborted) {
          setRoom(room);
          setActive(snapshot?.activeToken ?? null);
          setLoadError(false);
        }
      } catch {
        if (!signal.aborted) setLoadError(true);
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [user, apiUrl, refresh]);

  function reload() {
    setLoading(true);
    setRefresh((value) => value + 1);
  }

  async function act(action: "call-next" | "start" | "complete") {
    if (!room || busy) return;
    setBusy(true);
    setMessage("");
    const roomPath = `/api/opd/rooms/${room.id}`;
    try {
      if (action === "call-next") {
        const pending = `mediflow:room-call:${apiUrl}:${user.uid}:${room.id}`;
        const key = sessionStorage.getItem(pending) ?? crypto.randomUUID();
        sessionStorage.setItem(pending, key);
        const result = await opdRequest<{ empty: boolean; token: ActiveToken | null }>(user, apiUrl, `${roomPath}/call-next`, {
          method: "POST", headers: { "Idempotency-Key": key },
        });
        sessionStorage.removeItem(pending);
        setMessage(result.empty ? "No tokens are waiting." : `Called token ${result.token?.tokenNumber}.`);
      } else if (active) {
        await opdRequest(user, apiUrl, `${roomPath}/tokens/${active.id}/${action}`, { method: "POST" });
        setMessage(action === "start" ? `Started consultation for token ${active.tokenNumber}.`
          : `Completed consultation for token ${active.tokenNumber}.`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not confirm the room action. Refresh the room and try again.");
    } finally {
      reload();
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="doctor-heading">
      <h2 id="doctor-heading">Doctor consultation</h2>
      {loading ? <p role="status">Loading assigned room…</p> : loadError ? (
        <p role="status">Could not load your assigned room.</p>
      ) : room ? (
        <>
          <h3>{room.name}</h3>
          {active ? <p>Token {active.tokenNumber} · {active.status === "Called" ? "Called" : "In consultation"}</p>
            : <p>No active token.</p>}
          {!active && <button type="button" disabled={busy} onClick={() => void act("call-next")}>Call next in room</button>}
          {active?.status === "Called" && <button type="button" disabled={busy} onClick={() => void act("start")}>Start consultation</button>}
          {active?.status === "InConsultation" && <button type="button" disabled={busy} onClick={() => void act("complete")}>Complete consultation</button>}
        </>
      ) : <p>No room is assigned to you for today.</p>}
      <button type="button" disabled={loading || busy} onClick={reload}>Refresh room</button>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
