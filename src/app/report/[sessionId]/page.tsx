import { ReportView } from "@/components/report-view";

export const metadata = { title: "Feedback report | Talkzy" };

export default async function ReportPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return <ReportView sessionId={sessionId} />;
}
