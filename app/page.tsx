import { GuardProvider } from "../components/GuardProvider.tsx";
import { WalletBar } from "../components/WalletBar.tsx";
import { StatusPanel } from "../components/StatusPanel.tsx";
import { TxHistoryTable } from "../components/TxHistoryTable.tsx";
import { TelemetryFeed } from "../components/TelemetryFeed.tsx";
import { PanicPanel } from "../components/PanicPanel.tsx";
import { ScopeNotice } from "../components/bits.tsx";

export default function ConsolePage() {
  return (
    <GuardProvider>
      <WalletBar />
      <StatusPanel />
      <TxHistoryTable />
      <PanicPanel />
      <TelemetryFeed />
      <ScopeNotice compact />
    </GuardProvider>
  );
}
