import type { User } from "firebase/auth";
import { useEffect } from "react";
import { useClinicalResource } from "./clinical-resource";
import { formatToken } from "./suwadora";

type QueueToken = { tokenNumber: number; status: string; channel: string };

export function WorkspaceQueue({ user, apiUrl, revision, doctor }: {
  user: User; apiUrl: string; revision: number; doctor?: boolean;
}) {
  const { data, loading, error, refresh } = useClinicalResource<QueueToken[]>(
    user, apiUrl, "/api/opd/workspace-queue", revision,
  );

  useEffect(() => {
    if (loading) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 10_000);
    return () => window.clearInterval(interval);
  }, [loading, refresh]);

  return <section className={doctor ? "suwa-queue-rail" : "suwa-card suwa-queue-rail"} aria-label={doctor ? "Waiting queue" : "Shared queue"}>
    <h3>{doctor ? "Waiting queue" : "Shared queue"}</h3>
    {!doctor && <p>Today’s OPD queue · all channels</p>}
    {error && <p role="alert">{error}</p>}
    {!data && loading && <p role="status">Loading queue…</p>}
    {data?.length === 0 && <p>{doctor ? "No tokens are waiting." : "No active tokens today."}</p>}
    {!!data?.length && <ol>{data.map((item) => <li key={item.tokenNumber}>
      <strong>{formatToken(item.tokenNumber)}</strong>
      <span>{item.channel}<br />{item.status === "InConsultation" ? "In consultation" : item.status}</span>
    </li>)}</ol>}
  </section>;
}
