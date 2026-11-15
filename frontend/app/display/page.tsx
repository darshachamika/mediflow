"use client";

import { HubConnectionBuilder, HttpTransportType } from "@microsoft/signalr";
import { useEffect, useState } from "react";
import Link from "next/link";

type PublicToken = { tokenNumber: number; room: string };
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5080";

export default function OpdDisplay() {
  const [tokens, setTokens] = useState<PublicToken[] | null>(null);
  const [connection, setConnection] = useState("Connecting…");
  const [snapshotError, setSnapshotError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    let revision = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const hub = new HubConnectionBuilder()
      .withUrl(`${apiUrl}/hubs/opd`, { transport: HttpTransportType.WebSockets, skipNegotiation: true, withCredentials: false })
      .withAutomaticReconnect()
      .build();

    function update(items: PublicToken[]) {
      setTokens(items.map(({ tokenNumber, room }) => ({ tokenNumber, room })));
      setSnapshotError(false);
    }

    async function snapshot() {
      const request = ++revision;
      try {
        const response = await fetch(`${apiUrl}/api/opd/display`, { signal, cache: "no-store" });
        if (!response.ok) throw new Error("Display snapshot failed");
        const items: PublicToken[] = await response.json();
        if (!signal.aborted && request === revision) update(items);
      } catch {
        if (!signal.aborted && request === revision) setSnapshotError(true);
      }
    }

    hub.on("DisplayUpdated", (items: PublicToken[]) => {
      if (signal.aborted) return;
      revision++;
      update(items);
    });
    hub.onreconnecting(() => {
      if (!signal.aborted) setConnection("Reconnecting…");
    });
    hub.onreconnected(() => {
      if (signal.aborted) return;
      setConnection("Live");
      void snapshot();
    });
    hub.onclose(() => {
      if (signal.aborted) return;
      setConnection("Reconnecting…");
      retry = setTimeout(() => void connect(), 2_000);
    });

    async function connect() {
      try {
        await hub.start();
        if (signal.aborted) return;
        setConnection("Live");
        await snapshot();
      } catch {
        if (signal.aborted) return;
        setConnection("Reconnecting…");
        retry = setTimeout(() => void connect(), 2_000);
      }
    }

    void snapshot();
    void connect();
    return () => {
      controller.abort();
      clearTimeout(retry);
      void hub.stop();
    };
  }, []);

  return (
    <main>
      <h1>OPD token display</h1>
      <p role="status">{connection}</p>
      {snapshotError && <p role="status">The current display could not be loaded.</p>}
      {tokens?.length === 0 && <p>No tokens are currently called.</p>}
      {tokens && tokens.length > 0 && (
        <table>
          <thead><tr><th scope="col">Token number</th><th scope="col">Room</th></tr></thead>
          <tbody>{tokens.map(({ tokenNumber, room }) => (
            <tr key={tokenNumber}><td>{tokenNumber}</td><td>{room}</td></tr>
          ))}</tbody>
        </table>
      )}
      <Link href="/">MediFlow sign-in</Link>
    </main>
  );
}
