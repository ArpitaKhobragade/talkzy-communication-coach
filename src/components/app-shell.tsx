"use client";

import { Books, ChartLineUp, GearSix, House, Microphone, ShieldCheck, UserCircle, type Icon } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { syncProgress } from "@/services/progress-sync";
import { subscribe } from "@/services/storage";
import { useProfile } from "@/services/use-storage";
import { Spinner } from "./ui";

const NAV: { href: string; label: string; Icon: Icon }[] = [
  { href: "/", label: "Home", Icon: House },
  { href: "/library", label: "Library", Icon: Books },
  { href: "/progress", label: "Progress", Icon: ChartLineUp },
  { href: "/profile", label: "Profile", Icon: UserCircle },
  { href: "/settings", label: "Settings", Icon: GearSix },
  /** For the college admin: opens a password box, then the student panel. */
  { href: "/admin", label: "Admin", Icon: ShieldCheck },
];

/** Routes that work without a profile. */
const PUBLIC = ["/onboarding", "/privacy", "/check", "/admin"];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const profile = useProfile();
  const isPublic = PUBLIC.some((p) => pathname.startsWith(p));
  const focusMode = pathname.startsWith("/practice");

  useEffect(() => {
    if (profile === null && !isPublic) router.replace("/onboarding");
  }, [profile, isPublic, router]);

  // Each finished session is sent to the college admin once: now, and again whenever the saved sessions change.
  useEffect(() => {
    if (!profile) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const later = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void syncProgress(), 1500);
    };
    later();
    const off = subscribe(later);
    return () => {
      clearTimeout(timer);
      off();
    };
  }, [profile]);

  const waiting = !isPublic && (profile === undefined || profile === null);

  return (
    <div className="min-h-dvh">
      {!focusMode && (
        <header className="sticky top-0 z-20 border-b border-line bg-paper/90 backdrop-blur">
          <div className="mx-auto flex max-w-[1920px] items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-10 xl:px-16">
            <Link href="/" className="flex items-center gap-2.5 font-extrabold tracking-tight">
              <span className="grid h-9 w-9 place-items-center rounded-[50%_50%_50%_8px] bg-gradient-to-br from-[#ff9a56] to-[#ff5e7a] text-white shadow-sm" aria-hidden>
                <Microphone size={20} weight="fill" />
              </span>
              <span className="whitespace-nowrap text-[1.05rem]">Talkzy</span>
            </Link>
            {!profile && (
              <Link
                href="/admin"
                aria-current={isActive(pathname, "/admin") ? "page" : undefined}
                className="flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-muted hover:bg-surface hover:text-ink"
              >
                <ShieldCheck size={18} aria-hidden />
                Admin
              </Link>
            )}
            {profile && (
              <nav aria-label="Main" className="hidden gap-1 md:flex">
                {NAV.map(({ href, label, Icon }) => {
                  const active = isActive(pathname, href);
                  return (
                    <Link
                      key={href}
                      href={href}
                      aria-current={active ? "page" : undefined}
                      className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                        active ? "bg-ink text-paper" : "text-muted hover:bg-surface hover:text-ink"
                      }`}
                    >
                      {/* Icons only from the large breakpoint up, so the labels fit on a tablet. */}
                      <Icon size={18} weight={active ? "fill" : "regular"} aria-hidden className="hidden lg:block" />
                      {label}
                    </Link>
                  );
                })}
              </nav>
            )}
          </div>
        </header>
      )}

      <main className={`mx-auto max-w-[1920px] px-4 py-6 sm:px-6 md:py-10 lg:px-10 xl:px-16 ${profile && !focusMode ? "pb-28 md:pb-10" : ""}`}>
        {waiting ? <Spinner label="Loading your coach" /> : children}
      </main>

      {profile && !focusMode && (
        <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 backdrop-blur md:hidden">
          <ul className="mx-auto grid max-w-md grid-cols-6 gap-1 px-1 py-1.5">
            {NAV.map(({ href, label, Icon }) => {
              const active = isActive(pathname, href);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={`flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl px-0.5 text-[0.65rem] font-semibold transition-colors ${
                      active ? "bg-accent-soft text-accent-ink" : "text-muted"
                    }`}
                  >
                    <Icon size={22} weight={active ? "fill" : "regular"} aria-hidden />
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </div>
  );
}
