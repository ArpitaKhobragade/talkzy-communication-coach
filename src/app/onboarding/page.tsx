"use client";

import { useRouter } from "next/navigation";
import { ProfileForm } from "@/components/profile-form";
import { PageHeader } from "@/components/ui";
import { saveProfile } from "@/services/storage";
import { useProfile } from "@/services/use-storage";

export default function OnboardingPage() {
  const router = useRouter();
  const existing = useProfile();

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Welcome! Let's set up your coach"
        subtitle="Tell us a little about you so your reading passages and conversation questions match your subject. It takes about a minute."
      />
      <ProfileForm
        initial={existing ?? null}
        askConsent={!existing}
        submitLabel="Save and start"
        onSubmit={(p) => {
          saveProfile(p);
          router.push("/");
        }}
      />
    </div>
  );
}
