import type { User } from "firebase/auth";
import { useState, type FormEvent } from "react";
import { useClinicalResource } from "./clinical-resource";
import { opdRequest } from "./opd-request";
import { opdDateTime } from "./opd-time";
import { formatToken } from "./suwadora";

type Props = { user: User; apiUrl: string };
type Notice = { id: number; kind: string; tokenNumber: number | null;
  appointmentAt: string | null; deliveredAt: string; smsDelivery: string };
type FaqAnswer = { answer: string; sources: { id: number; title: string; source: string }[] };

export function PatientNotifications({ user, apiUrl }: Props) {
  const notices = useClinicalResource<Notice[]>(user, apiUrl, "/api/opd/notifications");
  const [filter, setFilter] = useState("");
  const shown = notices.data?.filter((notice) => !filter || notice.kind === filter);
  return (
    <section id="notifications" className="suwa-panel" aria-labelledby="notifications-title">
      <h2 id="notifications-title">Notifications</h2>
      <button type="button" onClick={notices.refresh} disabled={notices.loading}>Refresh notifications</button>
      <div className="suwa-notice-filters" aria-label="Filter notifications">
        {[["", "All notifications"], ["TokenCalled", "Token calls"], ["AppointmentReminder", "Appointment reminders"]].map(([value, label]) =>
          <button className="suwa-secondary" key={value} type="button" aria-pressed={filter === value}
            onClick={() => setFilter(value)}>{label}</button>)}
      </div>
      {notices.loading ? <p role="status">Loading notifications…</p> : notices.error ? <p role="alert">{notices.error}</p>
        : shown?.length ? <ul className="suwa-records suwa-notification-list" tabIndex={0} aria-label="Delivered notifications">{shown.map((notice) => (
          <li key={notice.id} className={`suwa-record${notice.kind === "TokenCalled" ? " suwa-call-notice" : ""}`}>
            <div><strong>{notice.kind === "TokenCalled" ? `Token ${notice.tokenNumber} called` : "Appointment reminder"}</strong>
            {notice.tokenNumber !== null && <p className="suwa-notice-ticket">{formatToken(notice.tokenNumber)}</p>}
            {notice.appointmentAt && <p>{opdDateTime.format(new Date(notice.appointmentAt))}</p>}</div>
            <div><span className="suwa-pill">SMS {notice.smsDelivery.toLowerCase()}</span>
            <p>Delivered {opdDateTime.format(new Date(notice.deliveredAt))}</p></div>
          </li>
        ))}</ul> : <p>{filter ? "No notifications of this type." : "No notifications yet."}</p>}
    </section>
  );
}

export function FaqAssistant({ user, apiUrl }: Props) {
  const [answer, setAnswer] = useState<FaqAnswer | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const question = String(new FormData(event.currentTarget).get("question")).trim();
    setAnswer(null);
    if (!question) {
      setError("Enter an OPD service question.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      setAnswer(await opdRequest<FaqAnswer>(user, apiUrl, "/api/opd/assistant/query", {
        method: "POST",
        body: JSON.stringify({ kind: "faq", question }),
      }));
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not load an answer. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="faq-assistant" className="suwa-panel" aria-labelledby="faq-title">
      <h2 id="faq-title">OPD FAQ assistant</h2>
      <p>Ask about OPD services. Leave out personal and medical details.</p>
      <form onSubmit={ask} className="suwa-faq-form">
        <label htmlFor="faq-question">Your question</label>
        <textarea id="faq-question" name="question" required maxLength={500} rows={3}
          placeholder="How do I check in for my OPD visit?" />
        <button type="submit" disabled={busy}>Ask</button>
      </form>
      {busy && <p role="status">Looking up the OPD guides…</p>}
      {error && <p role="alert">{error}</p>}
      {answer && <div className="suwa-answer" role="status">
        <p>{answer.answer}</p>
        {answer.sources.length > 0 && <><h3>Sources</h3><ul>
          {answer.sources.map((source) => <li key={source.id}>{source.title} · {source.source}</li>)}
        </ul></>}
      </div>}
    </section>
  );
}
