import { CommandPalette } from "../../components/CommandPalette.tsx";
import { GuardProvider } from "../../components/GuardProvider.tsx";
import { WalletBar } from "../../components/WalletBar.tsx";
import { DeployPanel } from "../../components/DeployPanel.tsx";
import { PolicyForm } from "../../components/PolicyForm.tsx";
import { ScopeNotice } from "../../components/bits.tsx";

export default function ConfigurePage() {
  return (
    <GuardProvider>
      <CommandPalette />
      <WalletBar />
      <DeployPanel />
      <PolicyForm />
      <ScopeNotice compact />
    </GuardProvider>
  );
}
