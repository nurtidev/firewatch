"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth, type Role } from "./auth";
import { DEFAULT_ROUTE } from "./nav";

/**
 * Client-side role guard for pages that don't mount AppShell — print pages
 * (app/callout/report, app/city/report) render standalone (`fw-report-root`,
 * no sidebar/shell), so AppShell's own guard effect — the one that redirects
 * a role away from a NAV route it can't see — never runs for them. This is
 * the same redirect logic, extracted so a standalone page can opt in.
 *
 * UX only, same as AppShell's guard: the backend still enforces the real
 * boundary per endpoint (a disallowed role gets 403 from the API regardless
 * of whether this hook ran) — this only prevents the page from sitting there
 * showing a spinner or a confusing generic error for a role that was never
 * going to be let in.
 *
 * Pass a module-level constant array for `roles` (not an inline literal) —
 * a new array identity every render would re-run the effect every render.
 */
export function useRoleGuard(roles: readonly Role[]) {
  const { user, ready } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (!roles.includes(user.role)) {
      router.replace(DEFAULT_ROUTE[user.role]);
    }
  }, [ready, user, roles, router]);

  const allowed = !!user && roles.includes(user.role);
  return { user, ready, allowed };
}
