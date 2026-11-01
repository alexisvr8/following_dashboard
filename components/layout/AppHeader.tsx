import Link from "next/link";
import { ProfileAvatar } from "@/components/layout/ProfileAvatar";
import { ThemeToggleButton } from "@/components/layout/ThemeToggleButton";
import { MainNav, MobileNav } from "@/components/layout/MainNav";
import { SyncStatus } from "@/components/layout/SyncStatus";

export function AppHeader() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur supports-backdrop-filter:bg-background/70">
      <div className="grid h-14 grid-cols-[1fr_auto_1fr] items-center gap-4 px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2 justify-self-start">
          <span className="flex size-7 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
            X
          </span>
          <span className="hidden text-sm font-semibold tracking-tight sm:inline">Xtract</span>
        </Link>
        <MainNav />
        <div className="flex items-center gap-2 justify-self-end">
          <SyncStatus />
          <ThemeToggleButton />
          <ProfileAvatar />
          <MobileNav />
        </div>
      </div>
    </header>
  );
}
