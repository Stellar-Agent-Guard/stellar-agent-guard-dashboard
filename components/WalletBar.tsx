"use client";

import { useState } from "react";
import { useGuard } from "./GuardProvider.tsx";
import { AddressText, ErrorBlock, short, useAddressLabel } from "./bits.tsx";
import { AddressBookModal } from "./AddressBookModal.tsx";
import { looksLikeContractAddress } from "../lib/guard/instance.ts";
import { IDLE_TIMEOUT_OPTIONS } from "../lib/guard/useIdleTimer.ts";

export function WalletBar() {
  const {
    wallet,
    walletError,
    connecting,
    connect,
    disconnect,
    instances,
    guard,
    selectGuard,
    addInstance,
    session,
  } = useGuard();
  const [newAddress, setNewAddress] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [bookOpen, setBookOpen] = useState(false);

  const selected = instances.find((instance) => instance.guard === guard);
  const guardNickname = useAddressLabel(guard);

  return (
    <div className="panel">
      <div className="split">
        <div>
          <label className="field">
            <span className="lbl">Guarded account (the smart account being operated)</span>
            <select value={guard} onChange={(event) => selectGuard(event.target.value)}>
              {instances.map((instance) => (
                <option key={instance.guard} value={instance.guard}>
                  {instance.label} — {short(instance.guard, 8, 6)}
                </option>
              ))}
            </select>
            <span className="hint">
              {selected?.provenance}
              {guardNickname ? ` · in your address book as “${guardNickname}”` : ""}
            </span>
          </label>
          <div className="row">
            <input
              value={newAddress}
              onChange={(event) => {
                setNewAddress(event.target.value);
                setAddError(null);
              }}
              placeholder="Add a guard contract address (C…)"
              aria-label="Guard contract address"
            />
            <button
              className="secondary"
              onClick={() => {
                const candidate = newAddress.trim();
                if (!looksLikeContractAddress(candidate)) {
                  setAddError("That is not a Soroban contract address (52 characters, starting with C).");
                  return;
                }
                addInstance(candidate, `Guard ${short(candidate, 6, 4)}`);
                setNewAddress("");
              }}
            >
              Add
            </button>
          </div>
          {addError && <ErrorBlock title="Could not add that instance" detail={addError} />}
          <div className="row" style={{ marginTop: 8 }}>
            <button className="secondary" onClick={() => setBookOpen(true)}>
              Address book
            </button>
            <span className="tiny muted">Name the addresses you operate.</span>
          </div>
        </div>

        <div>
          <span className="lbl muted" style={{ fontSize: 12.5 }}>
            Admin wallet
          </span>
          <div className="row" style={{ marginTop: 5 }}>
            {wallet ? (
              <>
                <span className="pill ok">connected</span>
                <AddressText address={wallet.address} />
                <button className="secondary" onClick={disconnect}>
                  Disconnect
                </button>
              </>
            ) : (
              <button onClick={() => void connect()} disabled={connecting}>
                {connecting ? "Waiting for wallet…" : "Connect admin wallet"}
              </button>
            )}
          </div>
          <p className="tiny muted" style={{ marginTop: 8 }}>
            Every write on this page is signed by this wallet inside the Freighter extension and
            broadcast straight to Soroban RPC. The console never sees, stores or transmits a secret
            key, and there is no server component that could hold one.
          </p>
          <label className="field" style={{ marginTop: 8 }}>
            <span className="lbl">Auto-lock after inactivity</span>
            <select
              value={String(session.timeoutMs)}
              onChange={(event) => session.setTimeoutMs(Number(event.target.value))}
            >
              {IDLE_TIMEOUT_OPTIONS.map((option) => (
                <option key={option.valueMs} value={String(option.valueMs)}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="hint">
              {session.timeoutMs === 0
                ? "The session will not lock automatically."
                : `The wallet disconnects after ${Math.round(session.timeoutMs / 60000)} minute(s) of inactivity, with a 60s warning first.`}
            </span>
          </label>
          {walletError && <ErrorBlock title="Wallet connection" detail={walletError} />}
        </div>
      </div>

      {bookOpen && <AddressBookModal onClose={() => setBookOpen(false)} />}
    </div>
  );
}
