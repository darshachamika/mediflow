import type { User } from "firebase/auth";
import { useState } from "react";
import { clinicalError, useClinicalResource } from "./clinical-resource";
import { opdRequest } from "./opd-request";

type LabTask = { id: number; test: string; status: "Requested" | "Entered"; result: string | null };

export function ClinicalLab({ user, apiUrl }: { user: User; apiUrl: string }) {
  const worklist = useClinicalResource<LabTask[]>(user, apiUrl, "/api/clinical/lab/worklist");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  async function update(task: LabTask, result?: string) {
    setStatus("");
    setError("");
    if (result !== undefined && !result.trim()) {
      setError("Enter a result before saving.");
      return;
    }
    setBusy(true);
    try {
      const path = `/api/clinical/lab/${task.id}`;
      if (result !== undefined) {
        await opdRequest(user, apiUrl, `${path}/result`, {
          method: "PUT", body: JSON.stringify({ result: result.trim() }),
        });
        setStatus(`Result entered for ${task.test}.`);
      } else {
        await opdRequest(user, apiUrl, `${path}/verify`, { method: "POST" });
        setStatus(`Result verified for ${task.test}. The treating doctor can now publish it.`);
      }
      worklist.refresh();
    } catch (error) {
      setError(clinicalError(error, "Could not update the lab request. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="lab-heading">
      <h2 id="lab-heading">Laboratory worklist</h2>
      <button type="button" onClick={worklist.refresh} disabled={busy || worklist.loading}>Refresh worklist</button>
      {worklist.loading && <p role="status">Loading lab requests…</p>}
      {worklist.error && <p role="alert">{worklist.error}</p>}
      {worklist.data?.length === 0 && <p>No requests need entry or verification.</p>}
      {!!worklist.data?.length && (
        <ul>{worklist.data.map((task) => (
          <LabTaskRow key={task.id} task={task} busy={busy || worklist.loading} update={update} />
        ))}</ul>
      )}
      {status && <p role="status">{status}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

function LabTaskRow({ task, busy, update }: {
  task: LabTask;
  busy: boolean;
  update: (task: LabTask, result?: string) => Promise<void>;
}) {
  const [result, setResult] = useState("");

  return (
    <li>
      <h3>{task.test}</h3>
      <p>Request {task.id} · {task.status}</p>
      {task.status === "Requested" ? (
        <form onSubmit={(event) => {
          event.preventDefault();
          void update(task, result);
        }}>
          <label>Lab result <textarea rows={4} value={result} onChange={(event) => setResult(event.target.value)} maxLength={8000} required /></label>{" "}
          <button disabled={busy}>Save lab result</button>
        </form>
      ) : (
        <>
          <p style={{ whiteSpace: "pre-wrap" }}>{task.result}</p>
          <button type="button" disabled={busy} onClick={() => void update(task)}>Verify lab result</button>
        </>
      )}
    </li>
  );
}
