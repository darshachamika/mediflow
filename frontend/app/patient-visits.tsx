import type { User } from "firebase/auth";
import { useClinicalResource } from "./clinical-resource";
import { opdDateTime } from "./opd-time";

type Summary = { visitId: number; opdDate: string; summary: string; publishedAt: string };
type Result = { id: number; test: string; result: string; publishedAt: string };
type Appointment = { id: number; startsAt: string };

export function PatientVisits({ user, apiUrl }: { user: User; apiUrl: string }) {
  const summaries = useClinicalResource<Summary[]>(user, apiUrl, "/api/clinical/me/visits");
  const results = useClinicalResource<Result[]>(user, apiUrl, "/api/clinical/me/lab");
  const appointments = useClinicalResource<Appointment[]>(user, apiUrl, "/api/clinical/me/appointments");
  const upcoming = appointments.data?.filter((item) => Date.parse(item.startsAt) >= Date.now());

  return (
    <section aria-labelledby="my-visits">
      <h2 id="my-visits">My Visits</h2>
      <button type="button" disabled={summaries.loading || results.loading || appointments.loading} onClick={() => {
        summaries.refresh();
        results.refresh();
        appointments.refresh();
      }}>Refresh My Visits</button>

      <h3>Visit summaries</h3>
      {summaries.loading ? <p role="status">Loading visit summaries…</p> : summaries.error ? <p role="alert">{summaries.error}</p>
        : summaries.data?.length ? (
          <ul>{summaries.data.map((item) => (
            <li key={item.visitId}>
              <time dateTime={item.opdDate}>{item.opdDate}</time>
              <p style={{ whiteSpace: "pre-wrap" }}>{item.summary}</p>
            </li>
          ))}</ul>
        ) : <p>No published visit summaries.</p>}

      <h3>Lab results</h3>
      {results.loading ? <p role="status">Loading lab results…</p> : results.error ? <p role="alert">{results.error}</p>
        : results.data?.length ? (
          <ul>{results.data.map((item) => (
            <li key={item.id}>
              <h4>{item.test}</h4>
              <p style={{ whiteSpace: "pre-wrap" }}>{item.result}</p>
              <time dateTime={item.publishedAt}>{opdDateTime.format(new Date(item.publishedAt))}</time>
            </li>
          ))}</ul>
        ) : <p>No published lab results.</p>}

      <h3>Upcoming appointments</h3>
      {appointments.loading ? <p role="status">Loading appointments…</p> : appointments.error ? <p role="alert">{appointments.error}</p>
        : upcoming?.length ? (
          <ul>{upcoming.map((item) => (
            <li key={item.id}><time dateTime={item.startsAt}>{opdDateTime.format(new Date(item.startsAt))}</time></li>
          ))}</ul>
        ) : <p>No upcoming appointments.</p>}
    </section>
  );
}
