"use client";

import { Books, ChartLineUp, GearSix, House, Microphone, UserCircle, type Icon } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useProfile } from "@/services/use-storage";
import { Spinner } from "./ui";

const NAV: { href: string; label: string; Icon: Icon }[] = [
  { href: "/", label: "Home", Icon: House },
  { href: "/library", label: "Library", Icon: Books },
  { href: "/progress", label: "Progress", Icon: ChartLineUp },
  { href: "/profile", label: "Profile", Icon: UserCircle },
  { href: "/settings", label: "Settings", Icon: GearSix },
];

/** Routes that work without a profile. */
const PUBLIC = ["/onboarding", "/privacy"];

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

  const waiting = !isPublic && (profile === undefined || profile === null);

  return (
    <div className="min-h-dvh">
      {!focusMode && (
        <header className="sticky top-0 z-20 border-b border-line bg-paper/90 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 md:px-8">
            <Link href="/" className="flex items-center gap-2.5 font-extrabold tracking-tight">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent text-white shadow-sm" aria-hidden>
                <Microphone size={20} weight="fill" />
              </span>
              <span className="whitespace-nowrap text-[1.05rem]">Talkzy</span>
            </Link>
            {profile && (
              <nav aria-label="Main" className="hidden gap-1 md:flex">
                {NAV.map(({ href, label, Icon }) => {
                  const active = isActive(pathname, href);
                  return (
                    <Link
                      key={href}
                      href={href}
                      aria-current={active ? "page" : undefined}
                      className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors ${
                        active ? "bg-accent-soft text-accent-ink" : "text-muted hover:bg-white hover:text-ink"
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

      <main className={`mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-10 ${profile && !focusMode ? "pb-28 md:pb-10" : ""}`}>
        {waiting ? <Spinner label="Loading your coach" /> : children}
      </main>

      {profile && !focusMode && (
        <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 backdrop-blur md:hidden">
          <ul className="mx-auto grid max-w-md grid-cols-5 gap-1 px-2 py-1.5">
            {NAV.map(({ href, label, Icon }) => {
              const active = isActive(pathname, href);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={`flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[0.7rem] font-semibold transition-colors ${
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
