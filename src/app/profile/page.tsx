"use client";

import { useState } from "react";
import { ProfileForm } from "@/components/profile-form";
import { Notice, PageHeader } from "@/components/ui";
import { saveProfile } from "@/services/storage";
import { useProfile } from "@/services/use-storage";

export default function ProfilePage() {
  const profile = useProfile();
  const [saved, setSaved] = useState(false);
  if (!profile) return null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Your profile" subtitle="Change your subject, difficulty or goal at any time. Your recommendations update straight away." />
      {saved && (
        <Notice tone="good" role="status">
          Profile saved.
        </Notice>
      )}
      <ProfileForm
        initial={profile}
        askConsent={false}
        submitLabel="Save changes"
        onSubmit={(p) => {
          saveProfile(p);
          setSaved(true);
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
      />
    </div>
  );
}
