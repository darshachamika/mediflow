import type { User } from "firebase/auth";
import { useState, type FormEvent } from "react";
import { clinicalError, useClinicalResource } from "./clinical-resource";
import { opdRequest } from "./opd-request";
import { opdDateTime } from "./opd-time";

type Visit = { id: number; tokenNumber: number; opdDate: string; status: "InConsultation" | "Completed"; hasPatient: boolean };
type Note = { notes: string; summary: string | null; publishedAt: string | null };
type LabRequest = { id: number; test: string; status: "Requested" | "Entered" | "Verified" | "Published"; result: string | null };
type VisitDetails = { note: Note | null; labRequests: LabRequest[] };

type ClinicalProps = { user: User; apiUrl: string };

export function DoctorClinical({ user, apiUrl, revision, selectedId, select }: ClinicalProps & {
  revision: number;
  selectedId: number | null;
  select: (id: number | null) => void;
}) {
  const visits = useClinicalResource<Visit[]>(user, apiUrl, "/api/clinical/visits", revision);
  const selected = visits.data?.find((visit) => visit.id === selectedId);

  return (
    <section aria-labelledby="clinical-heading">
      <h2 id="clinical-heading">Clinical visits</h2>
      <button type="button" onClick={visits.refresh} disabled={visits.loading}>Refresh visits</button>
      {visits.loading && <p role="status">Loading clinical visits…</p>}
      {visits.error && <p role="alert">{visits.error}</p>}
      {visits.data?.length === 0 && <p>No visits are assigned to you.</p>}
      {!!visits.data?.length && (
        <p><label>Visit{" "}
          <select value={selected?.id ?? ""} onChange={(event) => select(Number(event.target.value) || null)}>
            <option value="">Select a visit</option>
            {visits.data.map((visit) => (
              <option key={visit.id} value={visit.id}>
                {visit.opdDate} · Token {visit.tokenNumber} · {visit.status === "InConsultation" ? "In consultation" : "Completed"}
              </option>
            ))}
          </select>
        </label></p>
      )}
      {selected && <VisitChart key={selected.id} visit={selected} user={user} apiUrl={apiUrl} />}
    </section>
  );
}

function VisitChart({ visit, user, apiUrl }: ClinicalProps & { visit: Visit }) {
  const path = `/api/clinical/visits/${visit.id}`;
  const details = useClinicalResource<VisitDetails>(user, apiUrl, path);
  const [test, setTest] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function act(work: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await work();
    } catch (error) {
      setError(clinicalError(error, "Could not update the visit. Try again."));
    } finally {
      setBusy(false);
    }
  }

  function requestLab(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!test.trim()) {
      setError("Enter a lab test name.");
      return;
    }
    void act(async () => {
      await opdRequest(user, apiUrl, `${path}/lab`, { method: "POST", body: JSON.stringify({ test: test.trim() }) });
      setTest("");
      setMessage("Lab test requested.");
      details.refresh();
    });
  }

  function publishLab(id: number) {
    void act(async () => {
      await opdRequest(user, apiUrl, `/api/clinical/lab/${id}/publish`, { method: "POST" });
      setMessage("Lab result published.");
      details.refresh();
    });
  }

  return (
    <section aria-labelledby="visit-chart-heading">
      <h3 id="visit-chart-heading">Visit for token {visit.tokenNumber}</h3>
      <button type="button" onClick={details.refresh} disabled={details.loading || busy}>Refresh visit</button>
      {details.loading && <p role="status">Loading visit record…</p>}
      {details.error && <p role="alert">{details.error}</p>}
      {details.data && (
        <>
          <VisitNoteEditor visit={visit} user={user} apiUrl={apiUrl} initialNote={details.data.note} />
          <h4>Lab requests</h4>
          <form onSubmit={requestLab}>
            <label>Test name <input value={test} onChange={(event) => setTest(event.target.value)} maxLength={160} required /></label>{" "}
            <button disabled={busy || details.loading}>Request lab test</button>
          </form>
          {details.data.labRequests.length === 0 && <p>No tests have been requested for this visit.</p>}
          {!!details.data.labRequests.length && <ul>{details.data.labRequests.map((request) => (
            <li key={request.id}>
              <p>{request.test} · {request.status}</p>
              {request.result !== null && <p style={{ whiteSpace: "pre-wrap" }}>{request.result}</p>}
              {request.status === "Verified" && (
                <button type="button" disabled={busy || details.loading} onClick={() => publishLab(request.id)}>
                  Publish result for {request.test}
                </button>
              )}
            </li>
          ))}</ul>}
          {message && <p role="status">{message}</p>}
          {error && <p role="alert">{error}</p>}
          {visit.status === "Completed" && visit.hasPatient && <FollowUp visitId={visit.id} user={user} apiUrl={apiUrl} />}
        </>
      )}
    </section>
  );
}

function VisitNoteEditor({ visit, user, apiUrl, initialNote }: ClinicalProps & { visit: Visit; initialNote: Note | null }) {
  const [saved, setSaved] = useState(initialNote);
  const [notes, setNotes] = useState(initialNote?.notes ?? "");
  const [summary, setSummary] = useState(initialNote?.summary ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const path = `/api/clinical/visits/${visit.id}`;
  const published = initialNote?.publishedAt ?? saved?.publishedAt;
  const dirty = notes !== (saved?.notes ?? "") || summary !== (saved?.summary ?? "");

  async function update(publish: boolean) {
    setMessage("");
    setError("");
    if (!publish && !notes.trim()) {
      setError("Enter the private visit notes before saving.");
      return;
    }
    setBusy(true);
    try {
      if (publish && saved?.summary) {
        const result = await opdRequest<{ publishedAt: string }>(user, apiUrl, `${path}/publish`, { method: "POST" });
        setSaved({ ...saved, publishedAt: result.publishedAt });
        setMessage("Visit summary published.");
      } else {
        const note = await opdRequest<Note>(user, apiUrl, `${path}/note`, {
          method: "PUT", body: JSON.stringify({ notes: notes.trim(), summary: summary.trim() || null }),
        });
        setSaved(note);
        setNotes(note.notes);
        setSummary(note.summary ?? "");
        setMessage("Visit draft saved.");
      }
    } catch (error) {
      setError(clinicalError(error, "Could not update the visit notes. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h4>Visit notes and summary</h4>
      <form onSubmit={(event) => {
        event.preventDefault();
        void update(false);
      }}>
        <p><label>Private visit notes<br />
          <textarea rows={5} maxLength={16000} value={notes} onChange={(event) => setNotes(event.target.value)} required disabled={busy || !!published} />
        </label></p>
        <p><label>Patient-facing summary<br />
          <textarea rows={4} maxLength={8000} value={summary} onChange={(event) => setSummary(event.target.value)} disabled={busy || !!published} />
        </label></p>
        {published ? <p>Published <time dateTime={published}>{opdDateTime.format(new Date(published))}</time></p> : (
          <>
            <button disabled={busy || !dirty}>Save visit draft</button>{" "}
            {visit.status === "Completed" && visit.hasPatient ? (
              <button type="button" disabled={busy || dirty || !saved?.summary} onClick={() => void update(true)}>Publish visit summary</button>
            ) : visit.hasPatient && <p>Complete the consultation before publishing the summary.</p>}
          </>
        )}
      </form>
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </>
  );
}

function FollowUp({ visitId, user, apiUrl }: ClinicalProps & { visitId: number }) {
  const [localTime, setLocalTime] = useState("");
  const [capacity, setCapacity] = useState("1");
  const [busy, setBusy] = useState(false);
  const [booked, setBooked] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function schedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    // The input is a hospital wall-clock time. Sri Lanka uses UTC+05:30.
    const startsAt = `${localTime}:00+05:30`;
    const count = Number(capacity);
    if (!Number.isFinite(Date.parse(startsAt)) || Date.parse(startsAt) <= Date.now()
      || !Number.isInteger(count) || count < 1 || count > 100) {
      setError("Enter a future Sri Lanka date and time and a capacity from 1 to 100.");
      return;
    }
    setBusy(true);
    try {
      const slot = await opdRequest<{ id: number }>(user, apiUrl, "/api/clinical/slots", {
        method: "POST", body: JSON.stringify({ startsAt, capacity: count }),
      });
      const appointment = await opdRequest<{ startsAt: string }>(user, apiUrl, `/api/clinical/visits/${visitId}/follow-up/${slot.id}`, { method: "POST" });
      setBooked(appointment.startsAt);
    } catch (error) {
      setError(clinicalError(error, "Could not schedule the follow-up. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h4>Follow-up appointment</h4>
      <form onSubmit={schedule}>
        <p><label>Sri Lanka appointment date and time <input type="datetime-local" value={localTime} onChange={(event) => setLocalTime(event.target.value)} required /></label></p>
        <p><label>Slot capacity <input type="number" min={1} max={100} step={1} value={capacity} onChange={(event) => setCapacity(event.target.value)} required /></label></p>
        <button disabled={busy}>Schedule follow-up</button>
      </form>
      {booked && <p role="status">Follow-up scheduled for <time dateTime={booked}>{opdDateTime.format(new Date(booked))}</time>.</p>}
      {error && <p role="alert">{error}</p>}
    </>
  );
}
