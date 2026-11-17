import type { User } from "firebase/auth";
import { useState, type ChangeEvent, type FormEvent } from "react";
import { isCheckInCode, readCheckInQr } from "./check-in-qr";
import { useCheckInCamera } from "./use-check-in-camera";
import { OpdRequestError, opdRequest } from "./opd-request";
import { WorkspaceRail } from "./suwadora";
import { WorkspaceQueue } from "./workspace-queue";
import "./opd-print.css";

type Ticket = { id: number; tokenNumber: number; opdDate: string };
type ReceptionToken = Ticket & { status: string };
const reception = "/api/opd/reception";

export function OpdReception({ user, apiUrl }: { user: User; apiUrl: string }) {
  const [number, setNumber] = useState("");
  const [code, setCode] = useState("");
  const [lookup, setLookup] = useState<ReceptionToken | null>(null);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [scanMessage, setScanMessage] = useState("");
  const [revision, setRevision] = useState(0);
  const camera = useCheckInCamera();

  function acceptCode(value: string) {
    setCode(value);
    setScanMessage("QR read. Select Check in by QR to confirm.");
  }

  function leaveScanner() {
    camera.stop();
    if (camera.active) setScanMessage("");
  }

  async function perform(work: () => Promise<void>, report = setMessage) {
    if (busy) return;
    setBusy(true);
    report("");
    try {
      await work();
    } catch (error) {
      const status = error instanceof OpdRequestError ? error.status : null;
      if (status === 410) setCode("");
      report(status === 410 ? "The check-in QR has expired. Ask the patient for a new QR or use their token number."
        : status === 404 ? "No matching token was found for today."
        : status === 409 ? "This token cannot be checked in."
        : "Could not complete the reception request. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function findToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    leaveScanner();
    setLookup(null);
    void perform(async () => {
      setLookup(await opdRequest<ReceptionToken>(user, apiUrl, `${reception}/tokens/${encodeURIComponent(number)}`));
    });
  }

  async function checkIn(input: { code: string } | { tokenNumber: number }) {
    const result = await opdRequest<ReceptionToken>(user, apiUrl, `${reception}/check-in`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    if ("tokenNumber" in input) setLookup(result);
    setCode("");
    setScanMessage("");
    setRevision((value) => value + 1);
    ("code" in input ? setScanMessage : setMessage)(`Token ${result.tokenNumber} checked in.`);
  }

  async function readQr(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    camera.stop();
    setCode("");
    await perform(async () => {
      let image: ImageBitmap | undefined;
      try {
        image = await createImageBitmap(file);
        const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("Cannot decode image");
        const value = readCheckInQr(context, image, image.width, image.height);
        if (!value || !isCheckInCode(value)) throw new Error("Invalid QR");
        acceptCode(value);
      } catch {
        setScanMessage("Could not read a SuwaDora check-in QR from this image.");
      } finally {
        image?.close();
      }
    }, setScanMessage);
  }

  function issueWalkIn() {
    leaveScanner();
    void perform(async () => {
      const pending = `mediflow:walk-in:${apiUrl}:${user.uid}`;
      const key = sessionStorage.getItem(pending) ?? crypto.randomUUID();
      sessionStorage.setItem(pending, key);
      const issued = await opdRequest<Ticket>(user, apiUrl, `${reception}/walk-ins`, {
        method: "POST", headers: { "Idempotency-Key": key },
      });
      sessionStorage.removeItem(pending);
      setTicket(issued);
      setRevision((value) => value + 1);
      setMessage(`Walk-in token ${issued.tokenNumber} issued.`);
    });
  }

  return (
    <div className="suwa-workspace suwa-reception">
    <WorkspaceRail><nav aria-label="Reception desk">
      <a href="#reception-heading" aria-current="page">Reception</a>
      <a href="#reception-lookup" onClick={leaveScanner}>Find token</a>
      <a href="#walk-in" onClick={leaveScanner}>Walk-in token</a>
    </nav></WorkspaceRail>
    <section className="suwa-workspace-main" aria-labelledby="reception-heading">
      <div className="suwa-workspace-heading"><h1 id="reception-heading">OPD reception</h1><span>Reception workstation</span></div>
      <div className="suwa-reception-grid">
      <div>
      <div className="suwa-card suwa-check-in">
      <form onSubmit={(event) => {
        event.preventDefault();
        if (!camera.active && isCheckInCode(code.trim())) void perform(() => checkIn({ code: code.trim() }), setScanMessage);
      }}>
        <h2>Scan QR</h2>
        {camera.active ? <button type="button" onClick={() => {
          leaveScanner();
        }}>Stop camera</button> : <button className="suwa-gold" type="button" disabled={busy} onClick={() => {
          setCode("");
          void camera.start(acceptCode, setScanMessage);
        }}>Start camera</button>}
        <video className="suwa-qr-preview" ref={camera.video} hidden={!camera.active} muted playsInline aria-label="Camera preview" />
        {scanMessage && <p role="status">{scanMessage}</p>}
        <p><label>Check-in QR code <input value={code} onChange={(event) => setCode(event.target.value)} required /></label></p>
        <p><label>Upload QR image <input type="file" accept="image/*" onChange={readQr} disabled={busy} /></label></p>
        <button type="submit" disabled={busy || camera.active || !isCheckInCode(code.trim())}>Check in by QR</button>
      </form>
      <div id="reception-lookup">
      <form onSubmit={findToken}>
        <h2>Manual lookup</h2>
        <p><label>Token number <input type="number" min="1" step="1" value={number} required onFocus={leaveScanner} onChange={(event) => {
          setNumber(event.target.value);
          setLookup(null);
        }} disabled={busy} /></label></p>
        <button type="submit" disabled={busy}>Find token</button>
      </form>
      {lookup && (
        <p>Token {lookup.tokenNumber} · {lookup.status}{" "}
          {lookup.status === "Booked" && (
            <button type="button" disabled={busy} onClick={() => void perform(() => checkIn({ tokenNumber: lookup.tokenNumber }))}>Check in token</button>
          )}
        </p>
      )}
      </div>
      </div>
      <section id="walk-in" className="suwa-card suwa-walk-in">
      <h2>Walk-in token</h2>
      <p>Issue a General OPD token for a patient who arrived without an online booking.</p>
      <button className="suwa-gold" type="button" disabled={busy} onClick={issueWalkIn}>Issue walk-in token</button>
      {ticket && (
        <>
          <section className="opd-print-ticket" aria-label="Walk-in ticket">
            <h4>SuwaDora OPD</h4>
            <p>Token {ticket.tokenNumber}</p>
            <p><time dateTime={ticket.opdDate}>{ticket.opdDate}</time></p>
          </section>
          <button type="button" onClick={() => window.print()}>Print token</button>
        </>
      )}
      </section>
      {message && <p role="status">{message}</p>}
      </div>
      <WorkspaceQueue user={user} apiUrl={apiUrl} revision={revision} />
      </div>
    </section>
    </div>
  );
}
