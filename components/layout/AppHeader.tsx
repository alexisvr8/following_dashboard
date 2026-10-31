import { ProfileAvatar } from "@/components/layout/ProfileAvatar";

export function AppHeader() {
  return (
    <header className="flex items-center justify-end border-b px-6 py-3">
      <ProfileAvatar />
    </header>
  );
}
