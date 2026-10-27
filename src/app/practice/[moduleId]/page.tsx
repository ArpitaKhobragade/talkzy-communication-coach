import { PracticeSession } from "@/components/practice/practice-session";

export const metadata = { title: "Practice | Talkzy" };

export default async function PracticePage({ params }: { params: Promise<{ moduleId: string }> }) {
  const { moduleId } = await params;
  return <PracticeSession moduleId={moduleId} />;
}
