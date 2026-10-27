import { PracticeSession } from "@/components/practice/practice-session";

export const metadata = { title: "Practice | Talkzy" };

export default async function PracticePage({
  params,
  searchParams,
}: {
  params: Promise<{ moduleId: string }>;
  searchParams: Promise<{ goal?: string | string[] }>;
}) {
  const { moduleId } = await params;
  const sp = await searchParams;
  const goal = typeof sp.goal === "string" ? sp.goal : undefined;
  return <PracticeSession moduleId={moduleId} goalParam={goal} />;
}
