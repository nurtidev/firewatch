"use client";

import dynamic from "next/dynamic";
import Link from "next/link";

// MapLibre touches `window`, so render the map client-side only.
const RiskMap = dynamic(() => import("@/components/RiskMap"), { ssr: false });

export default function MapPage() {
  return (
    <main className="relative h-screen w-screen">
      <div className="absolute left-4 top-4 z-10 rounded-md bg-black/70 px-4 py-3 backdrop-blur">
        <Link href="/" className="text-xs tracking-widest text-neutral-400">
          ← FIREWATCH
        </Link>
        <h1 className="mt-1 text-sm font-semibold">Карта риска · Астана</h1>
        <div className="mt-2 flex gap-3 text-xs text-neutral-400">
          <span>● 0–35 низкий</span>
          <span>● 36–70 средний</span>
          <span>● 71–100 высокий</span>
        </div>
      </div>
      <RiskMap />
    </main>
  );
}
