"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { navForRole, ROLE_LABEL } from "@/lib/nav";

export default function AppShell({
  children,
  fullBleed = false,
}: {
  children: React.ReactNode;
  fullBleed?: boolean;
}) {
  const { user, ready, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (ready && !user) router.replace("/login");
  }, [ready, user, router]);

  if (!ready || !user) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-neutral-500">
        Загрузка…
      </div>
    );
  }

  const items = navForRole(user.role);

  return (
    <div className="flex h-screen bg-neutral-950">
      <aside className="flex w-60 shrink-0 flex-col border-r border-neutral-800 bg-black">
        <div className="px-5 py-5">
          <div className="text-lg font-bold">
            FireWatch<span style={{ color: "var(--fw-accent)" }}>.</span>
          </div>
          <div className="mt-0.5 text-[10px] tracking-widest text-neutral-600">
            ДЧС РК · АСТАНА
          </div>
        </div>

        <nav className="flex-1 space-y-0.5 px-3">
          {items.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`block rounded-md px-3 py-2 text-sm transition ${
                  active
                    ? "bg-neutral-800 text-white"
                    : "text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-neutral-800 px-4 py-3">
          <div className="text-sm text-neutral-200">{user.name}</div>
          <div className="text-[11px] text-neutral-500">
            {ROLE_LABEL[user.role]}
          </div>
          <button
            onClick={() => {
              logout();
              router.replace("/login");
            }}
            className="mt-2 text-[11px] tracking-widest text-neutral-500 hover:text-neutral-300"
          >
            ВЫЙТИ
          </button>
        </div>
      </aside>

      <main
        className={
          fullBleed ? "relative min-w-0 flex-1" : "min-w-0 flex-1 overflow-auto"
        }
      >
        {children}
      </main>
    </div>
  );
}
