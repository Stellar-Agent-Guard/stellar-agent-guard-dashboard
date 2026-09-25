import { GuardProvider } from "../../components/GuardProvider.tsx";
import { WalletBar } from "../../components/WalletBar.tsx";
import { DeployPanel } from "../../components/DeployPanel.tsx";
import { PolicyForm } from "../../components/PolicyForm.tsx";
import { SetupWizard } from "../../components/SetupWizard.tsx";
import { ScopeNotice } from "../../components/bits.tsx";

export default function ConfigurePage() {
  return (
    <GuardProvider>
      <WalletBar />
      <SetupWizard />
      <DeployPanel />
      <PolicyForm />
      <ScopeNotice compact />
    </GuardProvider>
  );
}
