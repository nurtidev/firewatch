/**
 * Dictionary registry. Each per-domain file exports
 *   `const dict: { en: Record<string,string>; kk: Record<string,string> }`
 * whose keys are the exact Russian source strings. This module merges every
 * registered domain into two flat lookup maps consumed by `useT` in ../i18n.
 *
 * ── Adding a domain dictionary (Wave 1+) ─────────────────────────────────
 *   1. create web/src/lib/i18n/<domain>.ts exporting `dict` in the shape above;
 *   2. add ONE import line and ONE spread entry below. That's it.
 *
 *   import { dict as dashboard } from "./dashboard";
 *   const DOMAINS = [common, dashboard];   // ← spread into the merge
 *
 * Later files win on key collisions, so keep keys domain-scoped when possible.
 */
import { dict as common } from "./common";
import { dict as landing } from "./landing";
import { dict as analytics } from "./analytics";
import { dict as objects } from "./objects";
import { dict as ops } from "./ops";

const DOMAINS = [common, landing, analytics, objects, ops];

export type Dict = { en: Record<string, string>; kk: Record<string, string> };

function merge(domains: Dict[]): Dict {
  const en: Record<string, string> = {};
  const kk: Record<string, string> = {};
  for (const d of domains) {
    Object.assign(en, d.en);
    Object.assign(kk, d.kk);
  }
  return { en, kk };
}

/** Merged flat maps: DICT.en / DICT.kk, keyed by Russian source string. */
export const DICT: Dict = merge(DOMAINS);
