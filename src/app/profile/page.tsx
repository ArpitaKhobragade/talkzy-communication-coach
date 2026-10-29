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
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Your profile" subtitle="Tap a section to change it. Your modules and questions follow what you choose here." />
      {saved && (
        <Notice tone="good" role="status">
          Saved. Your library and recommendations now match your subject, difficulty and goal.
        </Notice>
      )}
      <ProfileForm
        initial={profile}
        askConsent={false}
        collapsible
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
