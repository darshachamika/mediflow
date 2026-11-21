import type { User } from "firebase/auth";
import { useState } from "react";
import { useClinicalResource } from "./clinical-resource";
import { opdDateTime } from "./opd-time";
import { Veranda } from "./suwadora";

type Summary = { visitId: number; opdDate: string; summary: string; publishedAt: string };
type Result = { id: number; test: string; result: string; publishedAt: string };
type Appointment = { id: number; startsAt: string };

export function PatientVisits({ user, apiUrl, screen }: { user: User; apiUrl: string; screen: string }) {
  const summaries = useClinicalResource<Summary[]>(user, apiUrl, "/api/clinical/me/visits");
  const results = useClinicalResource<Result[]>(user, apiUrl, "/api/clinical/me/lab");
  const appointments = useClinicalResource<Appointment[]>(user, apiUrl, "/api/clinical/me/appointments");
  const [testType, setTestType] = useState("");
  const [appointmentPeriod, setAppointmentPeriod] = useState<"upcoming" | "past">("upcoming");
  const now = Date.now();
  const upcoming = appointments.data?.filter((item) => Date.parse(item.startsAt) >= now);
  const past = appointments.data?.filter((item) => Date.parse(item.startsAt) < now);
  const showVisits = screen === "my-visits";
  const showLab = screen === "patient-lab-results";
  const showAppointments = screen === "patient-appointments";
  const title = showLab ? "Lab Results" : showAppointments ? "Appointments" : "My Visits";
  const visibleAppointments = appointmentPeriod === "upcoming" ? upcoming : past;
  const next = upcoming?.[0];
  const types = [...new Set(results.data?.map((item) => item.test))].sort();

  return (
    <section className="suwa-record-layout" aria-label={title} id="my-visits">
      <aside className="suwa-record-rail">
      <h1>{title}</h1>
      <p>{showLab ? "Your published laboratory results" : showAppointments ? "Your OPD follow-up appointments"
        : "Your OPD visit history and published summaries"}</p>
      <button type="button" disabled={summaries.loading || results.loading || appointments.loading} onClick={() => {
        summaries.refresh();
        results.refresh();
        appointments.refresh();
      }}>Refresh My Visits</button>
      {showAppointments && <div className="suwa-filter-buttons" aria-label="Appointment period">
        <button type="button" aria-pressed={appointmentPeriod === "upcoming"} onClick={() => setAppointmentPeriod("upcoming")}>Upcoming</button>
        <button type="button" aria-pressed={appointmentPeriod === "past"} onClick={() => setAppointmentPeriod("past")}>Past appointments</button>
      </div>}
      {showVisits && <a className="suwa-rail-link" href="#today-tokens">OPD token history</a>}
      <Veranda ivory />
      </aside>

      <div className="suwa-record-main">
      <section hidden={!showVisits} aria-labelledby="visit-summaries">
      <h3 id="visit-summaries">Visit summaries</h3>
      {summaries.loading ? <p role="status">Loading visit summaries…</p> : summaries.error ? <p role="alert">{summaries.error}</p>
        : summaries.data?.length ? (
          <ul className="suwa-records">{summaries.data.map((item) => (
            <li className="suwa-record" key={item.visitId}>
              <header><time dateTime={item.opdDate}>{item.opdDate}</time><span className="suwa-pill">Summary published</span></header>
              <h4>General OPD</h4>
              <p style={{ whiteSpace: "pre-wrap" }}>{item.summary}</p>
            </li>
          ))}</ul>
        ) : <p>No published visit summaries.</p>}
      </section>

      <section hidden={!showLab} aria-labelledby="patient-lab-heading">
      <h3 id="patient-lab-heading">Lab results</h3>
      {showLab && <label className="suwa-inline">Test type <select value={testType} onChange={(event) => setTestType(event.target.value)}>
        <option value="">All test types</option>{types.map((type) => <option key={type}>{type}</option>)}
      </select></label>}
      {results.loading ? <p role="status">Loading lab results…</p> : results.error ? <p role="alert">{results.error}</p>
        : results.data?.length ? (
          <ul className="suwa-records">{results.data.filter((item) => !testType || item.test === testType).map((item) => (
            <li className="suwa-record" key={item.id}>
              <details>
                <summary><strong>{item.test}</strong> <span className="suwa-pill">Published</span>
                  <time dateTime={item.publishedAt}>{opdDateTime.format(new Date(item.publishedAt))}</time>
                </summary>
                <p style={{ whiteSpace: "pre-wrap" }}>{item.result}</p>
              </details>
            </li>
          ))}</ul>
        ) : <p>No published lab results.</p>}
      </section>

      <section hidden={!showAppointments} aria-labelledby="patient-appointments-heading">
      {showAppointments && next && appointmentPeriod === "upcoming" && <div className="suwa-next">
        <strong>Next follow-up</strong><time dateTime={next.startsAt}>{opdDateTime.format(new Date(next.startsAt))}</time>
      </div>}
      <h3 id="patient-appointments-heading">{appointmentPeriod === "past" ? "Past appointments" : "Upcoming appointments"}</h3>
      {appointments.loading ? <p role="status">Loading appointments…</p> : appointments.error ? <p role="alert">{appointments.error}</p>
        : visibleAppointments?.length ? (
          <ul className="suwa-records">{visibleAppointments.map((item) => (
            <li className="suwa-record" key={item.id}><header>
              <time dateTime={item.startsAt}>{opdDateTime.format(new Date(item.startsAt))}</time>
              <span className="suwa-pill">{appointmentPeriod === "upcoming" ? "Confirmed" : "Past"}</span>
            </header><p>General OPD</p></li>
          ))}</ul>
        ) : <p>{appointmentPeriod === "past" ? "No past appointments." : "No upcoming appointments."}</p>}
      </section>
      </div>
    </section>
  );
}
