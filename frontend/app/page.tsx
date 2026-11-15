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
import { PatientVisits } from "./patient-visits";
import { opdRequest } from "./opd-request";
import Link from "next/link";
import QRCode from "qrcode";

type Profile = { id: number; firebaseUid: string; role: string };
type Booking = { id: number; opdDate: string; tokenNumber: number };
type PatientToken = Booking & {
  status: "Booked" | "Waiting" | "Called" | "InConsultation" | "Completed" | "Cancelled" | "NoShow";
  calledAt: string | null;
  waitingAhead: number | null;
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
          setMessage("Your Firebase account is signed in. Ask an administrator to provision your MediFlow account.");
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
        if (!signal.aborted) setMessage("Could not reach the MediFlow API.");
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
      let failure = "Could not reach the MediFlow API.";
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
      const image = await QRCode.toDataURL(code, { width: 220, margin: 4 });
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

  return (
    <main>
      <h1>MediFlow</h1>
      <Link href="/display">Public OPD token display</Link>
      {!authReady ? <p role="status">Restoring sign-in…</p> : user ? (
        <>
          <p>Signed in as {user.email}</p>
          {profile && (
            <dl>
              <dt>App user ID</dt>
              <dd>{profile.id}</dd>
              <dt>Firebase UID</dt>
              <dd>{profile.firebaseUid}</dd>
              <dt>Role</dt>
              <dd>{profile.role}</dd>
            </dl>
          )}
          {profile?.role === "Patient" && (
            <>
              <p><a href="#my-visits">My Visits</a></p>
              {viewingToday && <button type="button" disabled={busy} onClick={handleBooking}>Book OPD token</button>}
              {viewingToday && booking && <p role="status">Booked OPD token {booking.tokenNumber} for {booking.opdDate}</p>}
              <section aria-labelledby="today-tokens">
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
                        {viewingToday && item.status === "Booked" && (
                          <> <button type="button" disabled={busy} onClick={() => void prepareCheckIn(item)}>Show check-in QR</button></>
                        )}
                        {viewingToday && (item.status === "Waiting" || item.status === "Booked") && (
                          <> <button type="button" disabled={busy} aria-label={`Cancel token ${item.tokenNumber}`}
                            onClick={() => void handleCancel(item)}>Cancel</button></>
                        )}
                        {viewingToday && item.status === "Booked" && checkInCode?.bookingId === item.id
                          && Date.parse(checkInCode.expiresAt) > Date.now() && (
                          <figure>
                            <img src={checkInCode.image} alt={`Check-in QR for token ${item.tokenNumber}`} width={220} height={220} />
                            <figcaption>Show this QR at reception. Expires at {calledTime.format(new Date(checkInCode.expiresAt))}.</figcaption>
                          </figure>
                        )}
                      </li>
                    ))}
                  </ul>
                ))}
              </section>
              <PatientVisits key={user.uid} user={user} apiUrl={apiUrl} />
            </>
          )}
          {profile?.role === "OpdStaff" && <OpdStaffQueue key={user.uid} user={user} apiUrl={apiUrl} />}
          {profile?.role === "Reception" && <OpdReception key={user.uid} user={user} apiUrl={apiUrl} />}
          {profile?.role === "Doctor" && <OpdDoctorRoom key={user.uid} user={user} apiUrl={apiUrl} />}
          {profile?.role === "LabStaff" && <ClinicalLab key={user.uid} user={user} apiUrl={apiUrl} />}
          <button type="button" disabled={busy} onClick={handleSignOut}>Sign out</button>
        </>
      ) : (
        <form onSubmit={handleSignIn}>
          <p><label>Email <input name="email" type="email" autoComplete="username" required /></label></p>
          <p><label>Password <input name="password" type="password" autoComplete="current-password" required /></label></p>
          <button type="submit" disabled={busy}>Sign in</button>
        </form>
      )}
      {message && <p role="status">{message}</p>}
    </main>
  );
}
