import type { Metadata } from "next";
import { DemoBadge } from "../components/DemoBadge.tsx";
import { Tabs } from "../components/bits.tsx";
import { AriaAnnouncer } from "../components/AriaAnnouncer.tsx";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stellar Agent Guard — operator console",
  description:
    "Configure, watch and freeze stellar-agent-guard smart accounts. Every action is signed in your own wallet and every number is read from the chain.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AriaAnnouncer />
        <div className="shell">
          <DemoBadge />
          <header className="top">
            <div className="brand">
              <h1>Stellar Agent Guard</h1>
              <span>operator console</span>
            </div>
            <div className="row">
              <span className="pill">Soroban testnet</span>
              <a href="https://github.com/aigbagbobila/stellar-agent-guard-contracts">contracts</a>
              <a href="https://github.com/aigbagbobila/stellar-agent-guard-sdk">sdk</a>
            </div>
          </header>
          <Tabs />
          {children}
        </div>
      </body>
    </html>
  );
}
