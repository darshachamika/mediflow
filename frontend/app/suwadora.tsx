import Link from "next/link";
import type { ReactNode } from "react";

export function Brand() {
  return <div className="suwa-brand">
    <img src="/suwadora/doorway-mark.webp" alt="" />
    <div><strong>SuwaDora</strong><p>Colombo OPD · Concept</p></div>
  </div>;
}

export function PortalHeader({ title, reception, account }: { title?: string; reception?: boolean; account?: ReactNode }) {
  return <header className={`suwa-header${reception ? " suwa-reception-header" : ""}`}>
    <Brand />
    {title && <span className="suwa-context">{title}</span>}
    <div className="suwa-header-actions">
      <Link href="/display">Public OPD token display</Link>
      {account}
    </div>
  </header>;
}

export function Veranda({ ivory = false }: { ivory?: boolean }) {
  return <img className={ivory ? "suwa-ivory-veranda" : "suwa-veranda"} src={`/suwadora/${ivory ? "ivory-veranda" : "veranda-footer"}.webp`} alt="" />;
}

export function WorkspaceRail({ children }: { children: ReactNode }) {
  return <aside className="suwa-rail">{children}</aside>;
}

export function formatToken(number: number) {
  return `A-${String(number).padStart(3, "0")}`;
}
