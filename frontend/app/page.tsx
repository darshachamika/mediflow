"use client";

import { FirebaseError, getApps, initializeApp } from "firebase/app";
import { browserSessionPersistence, connectAuthEmulator, getAuth, initializeAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from "firebase/auth";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { OpdStaffQueue } from "./opd-staff-queue";
import { calledTime, todayOpdDate } from "./opd-time";
import { OpdDatePicker } from "./opd-date-picker";
import { OpdReception } from "./opd-reception";
import { OpdDoctorRoom } from "./opd-doctor-room";
import { ClinicalLab } from "./clinical-lab";
import { OpdAdmin } from "./opd-admin";
import { FaqAssistant, PatientNotifications } from "./patient-support";
import { PatientVisits } from "./patient-visits";
import { opdRequest } from "./opd-request";
import { formatToken, PortalHeader, Veranda, WorkspaceRail } from "./suwadora";
import QRCode from "qrcode";

type Profile = { id: number; firebaseUid: string; role: string };
type Booking = { id: number; opdDate: string; tokenNumber: number };
type PatientToken = Booking & {
  status: "Booked" | "Waiting" | "Called" | "InConsultation" | "Completed" | "Cancelled" | "NoShow";
  calledAt: string | null;
  waitingAhead: number | null;
};

const patientScreens = [
  ["today-tokens", "My OPD visit"], ["my-visits", "My Visits"], ["patient-lab-results", "Lab results"],
  ["patient-appointments", "Appointments"], ["notifications", "Notifications"], ["faq-assistant", "FAQ assistant"],
] as const;
type PatientScreen = typeof patientScreens[number][0];
const visitSteps = ["Booked", "Checked in", "Called", "Complete"];
const visitProgress: Partial<Record<PatientToken["status"], number>> = {
  Booked: 0, Waiting: 1, Called: 2, InConsultation: 2, Completed: 3,
};

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5080";
const firebaseConfigured = Object.values(firebaseConfig).every(Boolean);

function initializePatientAuth() {
  const auth = initializeAuth(initializeApp(firebaseConfig), { persistence: browserSessionPersistence });
  const emulatorUrl = process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL;
  if (emulatorUrl) connectAuthEmulator(auth, emulatorUrl);
  return auth;
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [booking, setBooking] = useState<Booking | null>(null);
  const [tokenSnapshot, setTokenSnapshot] = useState<{ date: string; rows: PatientToken[] } | null>(null);
  const [tokenFailure, setTokenFailure] = useState<{ date: string; reason: string } | null>(null);
  const [historyDate, setHistoryDate] = useState<string | null>(null);
  const abortTokens = useRef<AbortController | null>(null);
  const refreshTokens = useRef<(() => void) | null>(null);
  const [authReady, setAuthReady] = useState(!firebaseConfigured);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [checkInCode, setCheckInCode] = useState<{ bookingId: number; image: string; expiresAt: string } | null>(null);
  const [screen, setScreen] = useState<PatientScreen>("today-tokens");
  const [passwordVisible, setPasswordVisible] = useState(false);

  useEffect(() => {
    if (!checkInCode) return;
    const timer = window.setTimeout(() => setCheckInCode(null), Math.max(0, Date.parse(checkInCode.expiresAt) - Date.now()));
    return () => window.clearTimeout(timer);
  }, [checkInCode]);

  useEffect(() => {
    function readScreen() {
      setScreen(patientScreens.find(([id]) => `#${id}` === window.location.hash)?.[0] ?? "today-tokens");
    }
    readScreen();
    window.addEventListener("hashchange", readScreen);
    return () => window.removeEventListener("hashchange", readScreen);
  }, []);

  useEffect(() => {
    if (!firebaseConfigured) return;

    const auth = getApps().length
      ? getAuth()
      : initializePatientAuth();
    let pending: AbortController | undefined;
    const unsubscribe = onAuthStateChanged(auth, async (signedInUser) => {
      pending?.abort();
      const controller = new AbortController();
      pending = controller;
      const { signal } = controller;
      setUser(signedInUser);
      setAuthReady(true);
      setProfile(null);
      setBooking(null);
      setCheckInCode(null);
      abortTokens.current?.abort();
      setTokenSnapshot(null);
      setTokenFailure(null);
      setHistoryDate(null);
      setMessage("");
      if (!signedInUser) return;

      try {
        const token = await signedInUser.getIdToken();
        const response = await fetch(`${apiUrl}/api/me`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
          signal,
        });
        if (signal.aborted) return;
        if (response.status === 403) {
          setMessage("Your Firebase account is signed in. Ask an administrator to provision your SuwaDora account.");
        } else if (response.status === 401) {
          setMessage("The API rejected your sign-in token. Sign out and try again.");
        } else if (response.ok) {
          const signedInProfile: Profile = await response.json();
          if (signal.aborted) return;
          setProfile(signedInProfile);
        } else {
          setMessage("The API could not load your profile.");
        }
      } catch {
        if (!signal.aborted) setMessage("Could not reach the SuwaDora API.");
      }
    });

    return () => {
      unsubscribe();
      pending?.abort();
    };
  }, []);

  const patient = profile?.role === "Patient" ? user : null;
  const today = todayOpdDate();
  const viewingToday = historyDate === null;
  const selectedDate = historyDate ?? today;
  const tokens = tokenSnapshot?.date === selectedDate ? tokenSnapshot.rows : null;
  const tokenError = tokenFailure?.date === selectedDate ? tokenFailure.reason : null;

  useEffect(() => {
    if (!patient) return;
    const controller = new AbortController();
    abortTokens.current = controller;
    const { signal } = controller;
    let inFlight = false;
    let refreshQueued = false;

    const refresh = async (queueIfBusy = false) => {
      if (signal.aborted || (viewingToday && document.visibilityState !== "visible")) return;
      if (inFlight) {
        refreshQueued ||= queueIfBusy;
        return;
      }

      inFlight = true;
      let failure = "Could not reach the SuwaDora API.";
      try {
        const token = await patient.getIdToken();
        if (signal.aborted) return;
        const response = await fetch(`${apiUrl}/api/opd/bookings?date=${encodeURIComponent(selectedDate)}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
          signal,
        });
        failure = `The bookings request returned HTTP ${response.status}.`;
        if (!response.ok) throw new Error(failure);

        failure = "The API did not return valid bookings JSON.";
        const payload: { opdDate?: unknown; items?: unknown } | null = await response.json();
        if (signal.aborted) return;

        failure = "The API did not return bookings for the selected date.";
        if (payload?.opdDate !== selectedDate) throw new Error(failure);

        failure = "The API did not return a bookings array.";
        if (!Array.isArray(payload.items)) throw new Error(failure);
        const items: PatientToken[] = payload.items;

        if (!signal.aborted) {
          setTokenSnapshot({ date: selectedDate, rows: items });
          setTokenFailure(null);
        }
      } catch {
        if (!signal.aborted) setTokenFailure({ date: selectedDate, reason: failure });
      } finally {
        inFlight = false;
        if (refreshQueued) {
          refreshQueued = false;
          void refresh();
        }
      }
    };

    function refreshNow() {
      void refresh(true);
    }

    refreshTokens.current = refreshNow;
    refreshNow();
    const interval = viewingToday ? window.setInterval(() => void refresh(), 10_000) : undefined;
    if (viewingToday) document.addEventListener("visibilitychange", refreshNow);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshNow);
      refreshTokens.current = null;
      abortTokens.current = null;
    };
  }, [patient, selectedDate, viewingToday]);

  function selectDate(date: string) {
    abortTokens.current?.abort();
    setHistoryDate(date === today ? null : date);
    setTokenSnapshot(null);
    setTokenFailure(null);
    setBooking(null);
    setCheckInCode(null);
    setMessage("");
  }

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setMessage("");
    if (!firebaseConfigured) {
      setMessage("Set the Firebase web app configuration before signing in.");
      return;
    }

    setBusy(true);
    try {
      await signInWithEmailAndPassword(
        getAuth(), String(form.get("email")), String(form.get("password")),
      );
    } catch (error) {
      setMessage(error instanceof FirebaseError && error.code.startsWith("auth/")
        ? "Firebase could not complete the request. Check your credentials and Firebase configuration."
        : "Could not sign in. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    setBusy(true);
    try {
      await signOut(getAuth());
    } catch {
      setMessage("Could not sign out. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleBooking() {
    if (!patient || !viewingToday || busy) return;

    setBusy(true);
    setMessage("");
    setBooking(null);
    setCheckInCode(null);
    try {
      const pendingKey = `mediflow:opd:${apiUrl}:${patient.uid}`;
      const key = sessionStorage.getItem(pendingKey) ?? crypto.randomUUID();
      sessionStorage.setItem(pendingKey, key);
      const token = await patient.getIdToken();
      const response = await fetch(`${apiUrl}/api/opd/bookings`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": key },
      });
      if (!response.ok) throw new Error("Booking request failed");

      const assignedBooking: Booking = await response.json();
      sessionStorage.removeItem(pendingKey);
      setBooking(assignedBooking);
      refreshTokens.current?.();
      if (assignedBooking.opdDate === selectedDate) await showQr(patient, assignedBooking.id);
    } catch {
      setMessage("Could not confirm your booking. Select Book OPD token to retry.");
    } finally {
      setBusy(false);
    }
  }

  async function showQr(owner: User, bookingId: number) {
    try {
      const { code, expiresAt } = await opdRequest<{ code: string; expiresAt: string }>(
        owner, apiUrl, `/api/opd/bookings/${bookingId}/check-in-code`, { method: "POST" });
      const image = await QRCode.toDataURL(code, { scale: 12, margin: 4, color: { dark: "#000000", light: "#ffffff" } });
      setCheckInCode({ bookingId, image, expiresAt });
    } catch {
      setMessage("Could not get a check-in QR. You can give reception your token number.");
    }
  }

  async function prepareCheckIn(item: PatientToken) {
    if (!patient || !viewingToday || busy) return;
    setBusy(true);
    setCheckInCode(null);
    setMessage("");
    try {
      await showQr(patient, item.id);
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel(item: PatientToken) {
    if (!patient || !viewingToday || busy) return;

    setBusy(true);
    setMessage("");
    try {
      const token = await patient.getIdToken();
      const response = await fetch(`${apiUrl}/api/opd/bookings/${item.id}/cancel`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const details = await response.json().catch(() => null);
        setMessage(details?.error ?? `Could not cancel token ${item.tokenNumber} (HTTP ${response.status}).`);
        if (response.status === 409 || response.status === 404) refreshTokens.current?.();
        return;
      }
      setMessage(`Cancelled token ${item.tokenNumber}.`);
      setCheckInCode(null);
      refreshTokens.current?.();
    } catch {
      setMessage(`Could not confirm cancellation of token ${item.tokenNumber}. Try again.`);
    } finally {
      setBusy(false);
    }
  }

  const ticketToken = viewingToday ? tokens?.find((item) => item.id === checkInCode?.bookingId && item.status === "Booked")
    ?? tokens?.findLast((item) => item.status !== "Cancelled" && item.status !== "NoShow") : undefined;
  const stage = ticketToken ? visitProgress[ticketToken.status] : undefined;
  const showQrImage = ticketToken && ticketToken.status === "Booked"
    && checkInCode?.bookingId === ticketToken.id && Date.parse(checkInCode.expiresAt) > Date.now();
  const context = profile?.role === "Patient"
    ? screen === "notifications" ? "Notifications" : screen === "faq-assistant" ? "OPD FAQ assistant" : "Patient Portal"
    : profile?.role === "Doctor" ? "Doctor Workspace" : profile?.role === "OpdAdmin" ? "OPD Administration"
      : profile?.role === "LabStaff" ? "Laboratory" : undefined;

  return (
    <main className="suwa-shell">
      <PortalHeader title={context} reception={profile?.role === "Reception"} account={user && (
          <div className="suwa-account">
            <span>Signed in as {user.email}</span>
            <button type="button" disabled={busy} onClick={handleSignOut}>Sign out</button>
          </div>
      )} />
      {!authReady ? <p role="status">Restoring sign-in…</p> : user ? (
        <>
          {message && <p className="suwa-message" role="status">{message}</p>}
          {profile?.role === "Patient" && (
            <>
              <nav className="suwa-nav" aria-label="Patient portal">
                {patientScreens.map(([id, label]) => <a key={id} href={`#${id}`}
                  aria-current={screen === id ? "page" : undefined} onClick={() => setScreen(id)}>{label}</a>)}
              </nav>
              <div hidden={screen !== "today-tokens"}>
                <div className="suwa-visit">
                  <div className="suwa-progress">
                    <h1>My OPD visit</h1>
                    <ol>{visitSteps.map((step, index) => <li key={step} aria-current={stage === index ? "step" : undefined}
                      className={stage !== undefined && index < stage ? "suwa-step-done" : undefined}><span>{step}</span></li>)}</ol>
                    {viewingToday && <button type="button" disabled={busy} onClick={handleBooking}>Book OPD token</button>}
                    {viewingToday && booking && <p role="status">Booked OPD token {booking.tokenNumber} for {booking.opdDate}</p>}
                    {ticketToken?.status === "Booked" && <p className="suwa-callout">Show your token at reception</p>}
                  </div>
                  <div className="suwa-door-ticket">
                    <div className="suwa-door-frame">
                      <h2>General OPD</h2>
                      {ticketToken ? <p className="suwa-ticket-number">{formatToken(ticketToken.tokenNumber)}</p>
                        : <p>{viewingToday ? "Your token will appear here." : "Select Today to view your active ticket."}</p>}
                      {showQrImage && <figure>
                        <img src={checkInCode.image} alt={`Check-in QR for token ${ticketToken.tokenNumber}`} width={220} height={220} />
                        <figcaption>Expires at {calledTime.format(new Date(checkInCode.expiresAt))}</figcaption>
                      </figure>}
                      {ticketToken?.status === "Booked" && !showQrImage && <button className="suwa-gold" type="button"
                        disabled={busy} onClick={() => void prepareCheckIn(ticketToken)}>Show check-in QR</button>}
                    </div>
                  </div>
                </div>
                <Veranda />
              <section className="suwa-panel suwa-token-history" aria-labelledby="today-tokens">
                <h2 id="today-tokens">{viewingToday ? "Today’s OPD tokens" : `OPD tokens for ${selectedDate}`}</h2>
                <OpdDatePicker date={selectedDate} today={today} disabled={busy} onSelect={selectDate} />
                {tokens === null && !tokenError && <p role="status">Loading tokens…</p>}
                {tokenError && <p role="status">{tokenError}{tokens !== null && " Showing the last update."}</p>}
                {tokens && (tokens.length === 0 ? (
                  <p>You have no OPD tokens for this date.</p>
                ) : (
                  <ul>
                    {tokens.map((item) => (
                      <li key={item.id}>
                        Token {item.tokenNumber} for <time dateTime={item.opdDate}>{item.opdDate}</time> · {item.status}
                        {viewingToday && item.status === "Waiting" && item.waitingAhead !== null && (
                          <> · {item.waitingAhead === 0 ? "Next in queue" : `${item.waitingAhead} ahead in queue`}</>
                        )}
                        {item.calledAt && (
                          <> at <time dateTime={item.calledAt}>{calledTime.format(new Date(item.calledAt))}</time></>
                        )}
                        {viewingToday && item.status === "Booked" && item.id !== ticketToken?.id && (
                          <> <button type="button" disabled={busy} onClick={() => void prepareCheckIn(item)}>Show check-in QR</button></>
                        )}
                        {viewingToday && (item.status === "Waiting" || item.status === "Booked") && (
                          <> <button type="button" disabled={busy} aria-label={`Cancel token ${item.tokenNumber}`}
                            onClick={() => void handleCancel(item)}>Cancel</button></>
                        )}
                      </li>
                    ))}
                  </ul>
                ))}
              </section>
              </div>
              <div hidden={screen !== "my-visits" && screen !== "patient-lab-results" && screen !== "patient-appointments"}>
                <PatientVisits key={user.uid} user={user} apiUrl={apiUrl} screen={screen} />
              </div>
              <div hidden={screen !== "notifications" && screen !== "faq-assistant"} key={`support-${user.uid}`}>
                <div className="suwa-support-workspace">
                  <WorkspaceRail><nav aria-label="Patient support">
                    <a href="#notifications" onClick={() => setScreen("notifications")} aria-current={screen === "notifications" ? "page" : undefined}>Notifications</a>
                    <a href="#faq-assistant" onClick={() => setScreen("faq-assistant")} aria-current={screen === "faq-assistant" ? "page" : undefined}>FAQ assistant</a>
                  </nav></WorkspaceRail>
                  <div hidden={screen !== "notifications"}><PatientNotifications user={user} apiUrl={apiUrl} /></div>
                  <div hidden={screen !== "faq-assistant"}><FaqAssistant user={user} apiUrl={apiUrl} /></div>
                </div>
                <Veranda />
              </div>
            </>
          )}
          {profile?.role === "OpdStaff" && <OpdStaffQueue key={user.uid} user={user} apiUrl={apiUrl} />}
          {profile?.role === "Reception" && <OpdReception key={user.uid} user={user} apiUrl={apiUrl} />}
          {profile?.role === "Doctor" && <OpdDoctorRoom key={user.uid} user={user} apiUrl={apiUrl} />}
          {profile?.role === "LabStaff" && <ClinicalLab key={user.uid} user={user} apiUrl={apiUrl} />}
          {profile?.role === "OpdAdmin" && <OpdAdmin key={user.uid} user={user} apiUrl={apiUrl} />}
        </>
      ) : (
        <div className="suwa-sign-in">
          <div className="suwa-sign-art" aria-hidden="true" />
          <form onSubmit={handleSignIn} className="suwa-sign-card" aria-labelledby="sign-in-title">
            <h1 id="sign-in-title">Sign in</h1>
            <p>Patient Portal</p>
            <label>Email <input name="email" type="email" autoComplete="username" required /></label>
            <label>Password <input name="password" type={passwordVisible ? "text" : "password"} autoComplete="current-password" required /></label>
            <button className="suwa-secondary" type="button" aria-pressed={passwordVisible}
              onClick={() => setPasswordVisible((value) => !value)}>{passwordVisible ? "Hide password" : "Show password"}</button>
            <button type="submit" disabled={busy}>Sign in</button>
            {message && <p role="alert">{message}</p>}
          </form>
        </div>
      )}
    </main>
  );
}
