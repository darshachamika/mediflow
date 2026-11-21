import type { User } from "firebase/auth";
import { useEffect, useState } from "react";
import { opdRequest } from "./opd-request";
import { DoctorClinical } from "./doctor-clinical";
import { formatToken, WorkspaceRail } from "./suwadora";
import { WorkspaceQueue } from "./workspace-queue";

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
  const [selectedVisit, setSelectedVisit] = useState<number | null>(null);

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
    <div className="suwa-workspace suwa-doctor">
    <WorkspaceRail>
      {room && <WorkspaceQueue user={user} apiUrl={apiUrl} revision={refresh} doctor />}
      {room && !active && <button className="suwa-gold" type="button" disabled={loading || busy}
        onClick={() => void act("call-next")}>Call next in room</button>}
    </WorkspaceRail>
    <section className="suwa-workspace-main" aria-labelledby="doctor-heading">
      <div className="suwa-workspace-heading">
        <h1 id="doctor-heading">{room?.name ?? "Doctor Workspace"}</h1>
        {room && <span>OPD Consultation · <time dateTime={room.opdDate}>{room.opdDate}</time></span>}
      </div>
      <div className="suwa-card suwa-consultation">
      {loading ? <p role="status">Loading assigned room…</p> : loadError ? (
        <p role="status">Could not load your assigned room.</p>
      ) : room ? (
        <>
          {active && <strong className="suwa-active-token">{formatToken(active.tokenNumber)}</strong>}
          {active ? <p>Token {active.tokenNumber} · {active.status === "Called" ? "Called" : "In consultation"}</p>
            : <p>No active token.</p>}
          {active?.status === "Called" && <button type="button" disabled={busy} onClick={() => void act("start")}>Start consultation</button>}
          {active?.status === "InConsultation" && <button className="suwa-gold" type="button" disabled={busy} onClick={() => void act("complete")}>Complete consultation</button>}
          {active?.status === "InConsultation" && (
            <button type="button" onClick={() => setSelectedVisit(active.id)}>Open consultation</button>
          )}
        </>
      ) : <p>No room is assigned to you for today.</p>}
      <button type="button" disabled={loading || busy} onClick={reload}>Refresh room</button>
      {message && <p role="status">{message}</p>}
      </div>
      <DoctorClinical user={user} apiUrl={apiUrl} revision={refresh} selectedId={selectedVisit} select={setSelectedVisit} />
    </section>
    </div>
  );
}
