import type { User } from "firebase/auth";
import { useState, type FormEvent } from "react";
import { useClinicalResource } from "./clinical-resource";
import { opdRequest } from "./opd-request";
import { Veranda, WorkspaceRail } from "./suwadora";

type Department = { id: number; name: string };
type Room = Department & { departmentId: number | null; active: boolean };
type Assignment = { roomId: number; doctorId: number; opdDate: string };
type Counts = { opdDate: string; counts: { status: string; count: number }[] };
const path = "/api/opd/admin";

export function OpdAdmin({ user, apiUrl }: { user: User; apiUrl: string }) {
  const departments = useClinicalResource<Department[]>(user, apiUrl, path + "/departments");
  const rooms = useClinicalResource<Room[]>(user, apiUrl, path + "/rooms");
  const assignments = useClinicalResource<Assignment[]>(user, apiUrl, path + "/assignments");
  const counts = useClinicalResource<Counts>(user, apiUrl, path + "/counts");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);

  async function save(event: FormEvent<HTMLFormElement>, resource: string) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const values = Object.fromEntries(fields);
    const body = resource === "assignments"
      ? { roomId: Number(values.roomId), doctorId: Number(values.doctorId), opdDate: values.opdDate }
      : { name: String(values.name).trim(), ...(resource === "rooms" && { departmentId: Number(values.departmentId) }) };
    setMessage(null);
    setBusy(true);
    try {
      await opdRequest<unknown>(user, apiUrl, path + "/" + resource, {
        method: "POST", body: JSON.stringify(body),
      });
      form.reset();
      setMessage({ text: "Saved.", failed: false });
      if (resource === "departments") departments.refresh();
      if (resource === "rooms") rooms.refresh();
      if (resource === "assignments") assignments.refresh();
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "Could not save. Try again.", failed: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
    <nav className="suwa-nav" aria-label="OPD administration">
      <a href="#admin-title" aria-current="page">Administration</a><a href="#queue-counts">Queue</a>
      <a href="#assignments-title">Room assignments</a>
    </nav>
    <div className="suwa-workspace suwa-admin">
    <WorkspaceRail><nav aria-label="Administration sections">
      <a href="#queue-counts">Queue overview</a><a href="#departments-title">Departments</a>
      <a href="#rooms-title">Rooms</a><a href="#assignments-title">Room assignments</a>
    </nav></WorkspaceRail>
    <section className="suwa-workspace-main" aria-labelledby="admin-title">
      <h1 id="admin-title">OPD administration</h1>
      {message && <p role={message.failed ? "alert" : "status"}>{message.text}</p>}
      <section aria-labelledby="queue-counts">
        <h3 id="queue-counts">Queue counts {counts.data?.opdDate}</h3>
        <button type="button" onClick={counts.refresh} disabled={counts.loading}>Refresh counts</button>
        {counts.loading ? <p role="status">Loading queue counts…</p> : counts.error ? <p role="alert">{counts.error}</p>
          : counts.data && <ul className="suwa-counts">
            {["Waiting", "InConsultation", "Completed"].map((status) => <li key={status}>
              {status === "InConsultation" ? "In consultation" : status}
              <strong>{counts.data?.counts.find((row) => row.status === status)?.count ?? 0}</strong>
            </li>)}
            <li>Total today<strong>{counts.data.counts.reduce((total, row) => total + row.count, 0)}</strong></li>
          </ul>}
        {counts.data && <details className="suwa-all-counts"><summary>All statuses</summary>
          <ul>{counts.data.counts.map((row) => <li key={row.status}>{row.status}: {row.count}</li>)}</ul>
        </details>}
      </section>
      <div className="suwa-grid suwa-admin-grid">
        <section className="suwa-card" aria-labelledby="departments-title">
          <h3 id="departments-title">Departments</h3>
          {departments.loading ? <p role="status">Loading departments…</p> : departments.error ? <p role="alert">{departments.error}</p>
            : departments.data?.length ? <ul>{departments.data.map((item) => <li key={item.id}>{item.name}</li>)}</ul> : <p>No departments yet.</p>}
          <details><summary>New department</summary>
          <form onSubmit={(event) => void save(event, "departments")}>
            <label>Department name <input name="name" required maxLength={80} /></label>
            <button disabled={busy}>Add department</button>
          </form>
          </details>
        </section>
        <section className="suwa-card" aria-labelledby="rooms-title">
          <h3 id="rooms-title">Rooms</h3>
          {rooms.loading ? <p role="status">Loading rooms…</p> : rooms.error ? <p role="alert">{rooms.error}</p>
            : rooms.data?.length ? <ul>{rooms.data.map((room) => <li key={room.id}>{room.name}{room.active ? "" : " (inactive)"}</li>)}</ul> : <p>No rooms yet.</p>}
          <details><summary>New room</summary>
          <form onSubmit={(event) => void save(event, "rooms")}>
            <label>Room name <input name="name" required maxLength={80} /></label>
            <label>Department <select name="departmentId" defaultValue="" required>
              <option value="" disabled>Select department</option>
              {departments.data?.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
            </select></label>
            <button disabled={busy || !departments.data?.length}>Add room</button>
          </form>
          </details>
        </section>
        <section className="suwa-card" aria-labelledby="assignments-title">
          <h3 id="assignments-title">Room assignments</h3>
          {assignments.loading ? <p role="status">Loading assignments…</p> : assignments.error ? <p role="alert">{assignments.error}</p>
            : assignments.data?.length ? <ul>{assignments.data.map((row) => (
              <li key={`${row.opdDate}/${row.roomId}`}>{row.opdDate} · {rooms.data?.find((room) => room.id === row.roomId)?.name ?? `Room #${row.roomId}`} · Doctor #{row.doctorId}</li>
            ))}</ul> : <p>No upcoming room assignments.</p>}
          <details><summary>Assign a doctor</summary>
          <form onSubmit={(event) => void save(event, "assignments")}>
            <label>Room <select name="roomId" defaultValue="" required>
              <option value="" disabled>Select room</option>
              {rooms.data?.filter((room) => room.active).map((room) =>
                <option value={room.id} key={room.id}>{room.name}</option>)}
            </select></label>
            <label>Doctor user ID <input type="number" name="doctorId" min={1} step={1} required /></label>
            <label>OPD date <input type="date" name="opdDate" required /></label>
            <button disabled={busy || !rooms.data?.some((room) => room.active)}>Assign doctor</button>
          </form>
          </details>
        </section>
      </div>
    </section>
    </div>
    <Veranda />
    </>
  );
}
