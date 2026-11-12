"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, LayoutDashboard, Menu, Plug, SquareKanban, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/accionables", label: "Accionables", icon: SquareKanban },
  { href: "/cuentas", label: "Cuentas", icon: Building2 },
  { href: "/clientes", label: "Clientes", icon: Users },
  { href: "/conexiones", label: "Conexiones", icon: Plug },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Nav horizontal en el header (md+). */
export function MainNav() {
  const pathname = usePathname();
  return (
    <nav className="hidden items-center gap-1 md:flex">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors",
              active ? "font-medium text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            {label}
            <span
              className={cn(
                "absolute inset-x-3 -bottom-[11px] h-0.5 rounded-full bg-foreground transition-all duration-300",
                active ? "opacity-100" : "scale-x-0 opacity-0",
              )}
            />
          </Link>
        );
      })}
    </nav>
  );
}

/** Menú desplegable en pantallas angostas. */
export function MobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative md:hidden">
      <Button variant="ghost" size="icon" aria-label="Menú" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? <X className="size-4" /> : <Menu className="size-4" />}
      </Button>
      {open && (
        <nav className="absolute top-full right-0 mt-2 w-56 origin-top-right animate-in fade-in-0 zoom-in-95 rounded-lg border border-border-strong bg-popover p-1.5 shadow-popover backdrop-blur-md duration-150">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors",
                  active ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="size-4" />
                {label}
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}
