"use client";

import { FirebaseError, getApps, initializeApp } from "firebase/app";
import { browserSessionPersistence, getAuth, initializeAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from "firebase/auth";
import { useEffect, useState, type FormEvent } from "react";
import { OpdStaffQueue } from "./opd-staff-queue";

type Profile = { id: number; firebaseUid: string; role: string };
type Booking = { id: number; opdDate: string; tokenNumber: number };
type TokenList = { status: "loading" | "error" } | { status: "ready"; bookings: Booking[] };

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5080";
const firebaseConfigured = Object.values(firebaseConfig).every(Boolean);

async function fetchTokens(user: User, signal?: AbortSignal): Promise<TokenList> {
  try {
    const token = await user.getIdToken();
    const response = await fetch(`${apiUrl}/api/opd/bookings`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal,
    });
    if (response.ok) return { status: "ready", bookings: await response.json() };
  } catch {
    // Keep list errors separate from booking errors so a confirmed booking is never retried.
  }
  return { status: "error" };
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [booking, setBooking] = useState<Booking | null>(null);
  const [tokenList, setTokenList] = useState<TokenList>({ status: "loading" });
  const [authReady, setAuthReady] = useState(!firebaseConfigured);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!firebaseConfigured) return;

    const auth = getApps().length
      ? getAuth()
      : initializeAuth(initializeApp(firebaseConfig), { persistence: browserSessionPersistence });
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
      setTokenList({ status: "loading" });
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
          if (signedInProfile.role === "Patient") {
            const list = await fetchTokens(signedInUser, signal);
            if (!signal.aborted) setTokenList(list);
          }
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
    if (!user || profile?.role !== "Patient" || busy) return;

    setBusy(true);
    setMessage("");
    setBooking(null);
    try {
      const pendingKey = `mediflow:opd:${apiUrl}:${user.uid}`;
      const key = sessionStorage.getItem(pendingKey) ?? crypto.randomUUID();
      sessionStorage.setItem(pendingKey, key);
      const token = await user.getIdToken();
      const response = await fetch(`${apiUrl}/api/opd/bookings`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": key },
      });
      if (!response.ok) throw new Error("Booking request failed");

      const assignedBooking: Booking = await response.json();
      sessionStorage.removeItem(pendingKey);
      setBooking(assignedBooking);
      setTokenList({ status: "loading" });
      setTokenList(await fetchTokens(user));
    } catch {
      setMessage("Could not confirm your booking. Select Book OPD token to retry.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <h1>MediFlow</h1>
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
              <button type="button" disabled={busy || tokenList.status === "loading"} onClick={handleBooking}>Book OPD token</button>
              {booking && <p role="status">Booked OPD token {booking.tokenNumber} for {booking.opdDate}</p>}
              <section aria-labelledby="today-tokens">
                <h2 id="today-tokens">Today’s OPD tokens</h2>
                {tokenList.status === "loading" && <p role="status">Loading tokens…</p>}
                {tokenList.status === "error" && <p role="status">Could not load your tokens. Refresh the page to try again.</p>}
                {tokenList.status === "ready" && (tokenList.bookings.length === 0 ? (
                  <p>You have no OPD tokens for today.</p>
                ) : (
                  <ul>
                    {tokenList.bookings.map((item) => (
                      <li key={item.id}>Token {item.tokenNumber} for <time dateTime={item.opdDate}>{item.opdDate}</time></li>
                    ))}
                  </ul>
                ))}
              </section>
            </>
          )}
          {profile?.role === "OpdStaff" && <OpdStaffQueue key={user.uid} user={user} apiUrl={apiUrl} />}
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
