import { CheckPanel } from "@/components/check-panel";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Check my microphone and voice | Talkzy" };

export default function CheckPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Check my microphone and voice" subtitle="Finds out which part is not working in this browser: the coach service, the AI, saving, the microphone or the words." />
      <CheckPanel />
    </div>
  );
}
