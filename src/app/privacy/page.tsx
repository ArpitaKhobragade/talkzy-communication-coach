import { PrivacyExplainer } from "@/components/privacy-explainer";
import { Card, PageHeader } from "@/components/ui";

export const metadata = { title: "Privacy | Talkzy" };

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Privacy" subtitle="What the coach does with your voice, camera and words, in plain English." />
      <PrivacyExplainer />
      <Card className="space-y-2 text-[0.95rem] leading-relaxed">
        <h2 className="text-lg font-bold">Children and schools</h2>
        <p className="text-muted">
          Students under 13 need a parent or guardian to agree before using the app. The camera is always optional and starts switched off.
          The coach never asks for personal details, and if a student says they are unsafe or very upset, it suggests talking to a trusted
          adult. Schools using this app should add their own consent process and review the AI and speech services used.
        </p>
        <h2 className="pt-2 text-lg font-bold">Your controls</h2>
        <p className="text-muted">
          In Settings you can turn transcript saving off, delete a single session, export your data, or delete everything this app has stored.
        </p>
      </Card>
    </div>
  );
}
