import { ProfileAvatar } from "@/components/layout/ProfileAvatar";

export function AppHeader() {
  return (
    <header className="border-b">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold">Metodología de Seguimiento Xtract</h1>
          <p className="text-sm text-muted-foreground">Dashboard de cuentas y accionables</p>
        </div>
        <ProfileAvatar />
      </div>
    </header>
  );
}
