"use client";

/**
 * Diagonal repeating-on-every-page stamp for a print sheet (see the
 * `.fw-watermark` print rules in globals.css — `position: fixed` under
 * `@media print` so Chromium repeats it on every page of the document).
 *
 * Extracted from app/callout/report/page.tsx's local `Watermark()` (kept
 * there unchanged for now — another agent is editing that file in parallel;
 * switching it to this shared component is a follow-up). /city/report is the
 * first consumer, with the label "Демо-данные" instead of "Предварительно".
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
