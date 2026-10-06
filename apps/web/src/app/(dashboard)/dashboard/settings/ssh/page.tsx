import { notFound } from "next/navigation";

// SSH keys are hidden while editor (SSH) access is not offered. To bring the page back,
// restore the component below and its entry in components/dashboard/sidebar/nav-config.ts.
//
// import { SettingsPage } from "@/components/dashboard/settings/settings-page";
// import { SshSettingsSection } from "@/components/dashboard/settings/workspace-section";
//
// export default function SshSettingsPage() {
//   return (
//     <SettingsPage
//       title="SSH keys"
//       description="Manage the public key used for direct editor and terminal access."
//     >
//       <SshSettingsSection />
//     </SettingsPage>
//   );
// }

export default function SshSettingsPage() {
  notFound();
}
