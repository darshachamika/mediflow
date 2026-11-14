"use client";

import { FirebaseError, getApps, initializeApp } from "firebase/app";
import { getAuth, inMemoryPersistence, setPersistence, signInWithEmailAndPassword, signOut, type User } from "firebase/auth";
import { useState, type FormEvent } from "react";

type Profile = { id: number; firebaseUid: string; role: string };
type Booking = { id: number; opdDate: string; tokenNumber: number };

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5080";

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [booking, setBooking] = useState<Booking | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadProfile(signedInUser: User) {
    const token = await signedInUser.getIdToken();
    const response = await fetch(`${apiUrl}/api/me`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (response.ok) {
      setProfile(await response.json());
    } else if (response.status === 403) {
      setMessage("Your Firebase account is signed in. Ask an administrator to provision your MediFlow account.");
    } else if (response.status === 401) {
      setMessage("The API rejected your sign-in token. Sign out and try again.");
    } else {
      setMessage("The API could not load your profile.");
    }
  }

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setMessage("");
    if (Object.values(firebaseConfig).some((value) => !value)) {
      setMessage("Set the Firebase web app configuration before signing in.");
      return;
    }

    setBusy(true);
    try {
      const auth = getAuth(getApps()[0] ?? initializeApp(firebaseConfig));
      await setPersistence(auth, inMemoryPersistence);
      const { user: signedInUser } = await signInWithEmailAndPassword(
        auth, String(form.get("email")), String(form.get("password")),
      );
      setUser(signedInUser);
      await loadProfile(signedInUser);
    } catch (error) {
      setMessage(error instanceof FirebaseError && error.code.startsWith("auth/")
        ? "Firebase could not complete the request. Check your credentials and Firebase configuration."
        : "Could not reach the MediFlow API.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    setBusy(true);
    try {
      await signOut(getAuth());
      setUser(null);
      setProfile(null);
      setBooking(null);
      setMessage("");
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
    } catch {
      setMessage("Could not confirm your booking. Select Book OPD token to retry.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <h1>MediFlow</h1>
      {user ? (
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
              <button type="button" disabled={busy} onClick={handleBooking}>Book OPD token</button>
              {booking && <p role="status">OPD token {booking.tokenNumber} for {booking.opdDate}</p>}
            </>
          )}
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
