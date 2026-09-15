"use client";

/**
 * Diagonal repeating-on-every-page stamp for a print sheet (see the
 * `.fw-watermark` print rules in globals.css — `position: fixed` under
 * `@media print` so Chromium repeats it on every page of the document).
 *
 * Shared by the print pages: /callout/report ("Предварительно" on a callout
 * that isn't closed yet) and /city/report ("Демо-данные"). Same markup the
 * fire report used to keep locally — the printed sheet doesn't change.
 */
export default function Watermark({ label }: { label: string }) {
  return (
    <div
      className="fw-watermark pointer-events-none absolute inset-0 z-10 flex items-center justify-center overflow-hidden"
      aria-hidden
    >
      <span className="-rotate-[24deg] text-[54px] font-bold uppercase tracking-widest text-critical/10">
        {label}
      </span>
    </div>
  );
}
