import { PrivacyExplainer } from "@/components/privacy-explainer";
import { Card, PageHeader } from "@/components/ui";

export const metadata = { title: "Privacy | Talkzy" };

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Privacy" subtitle="What the coach does with your voice, camera and words, in plain English." />
      <PrivacyExplainer />
      <Card className="space-y-2 text-[0.95rem] leading-relaxed">
        <h2 className="text-lg font-bold">Colleges</h2>
        <p className="text-muted">
          Talkzy is made for college students. The camera and the microphone are in use while a student practises, and the student&apos;s name
          and reports are shared with the college&apos;s Talkzy admin. The coach never asks for personal details, and if a student says they are
          unsafe or very upset, it suggests talking to a trusted adult.
        </p>
        <h2 className="pt-2 text-lg font-bold">Your controls</h2>
        <p className="text-muted">
          In Settings you can turn transcript saving off, export your data, or delete everything this app has stored. On the Progress page you can delete a single report.
        </p>
      </Card>
    </div>
  );
}
