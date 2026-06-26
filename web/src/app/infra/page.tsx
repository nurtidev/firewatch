"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import AppShell from "@/components/AppShell";

const InfraMap = dynamic(() => import("@/components/InfraMap"), { ssr: false });

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";

type Stats = {
  stations: number;
  hydrants: number;
  broken_hydrants: number;
  blind_zone_buildings: number;
  blind_pct: number;
  normative_min: number;
};

export default function InfraPage() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/infra/stats`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setStats)
      .catch(() => {});
  }, []);

  return (
    <AppShell fullBleed>
      <div className="absolute left-4 top-4 z-10 max-w-xs rounded-md bg-black/75 px-4 py-3 backdrop-blur">
        <h1 className="text-sm font-semibold">
          Инфраструктура пожаротушения
        </h1>
        <p className="mt-0.5 text-[11px] text-neutral-400">
          Норматив прибытия {stats?.normative_min ?? 10} мин
        </p>
        <div className="mt-3 flex flex-col gap-1 text-xs text-neutral-300">
          <span>
            <span className="text-[#ff5a1f]">■</span> пожарные части
          </span>
          <span>
            <span className="text-[#3b82f6]">●</span> гидранты ·{" "}
            <span className="text-[#f59e0b]">●</span> неисправные
          </span>
          <span>
            <span className="text-[#22c55e]">▰</span> зона покрытия (≈10 мин)
          </span>
          <span>
            <span className="text-[#ef4444]">●</span> слепые зоны (вне норматива)
          </span>
        </div>
      </div>

      {stats && (
        <div className="absolute bottom-4 left-4 z-10 flex gap-5 rounded-md bg-black/80 px-5 py-3 backdrop-blur">
          <Stat value={stats.stations} label="пож. частей" />
          <Stat value={stats.hydrants.toLocaleString("ru")} label="гидрантов" />
          <Stat value={stats.broken_hydrants} label="неисправных" accent />
          <Stat
            value={stats.blind_zone_buildings.toLocaleString("ru")}
            label={`в слепых зонах · ${stats.blind_pct}%`}
            accent
          />
        </div>
      )}

      <InfraMap />
    </AppShell>
  );
}

function Stat({
  value,
  label,
  accent,
}: {
  value: string | number;
  label: string;
  accent?: boolean;
}) {
  return (
    <div>
      <div
        className="text-2xl font-bold"
        style={{ color: accent ? "#ff5a1f" : "#fff" }}
      >
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-widest text-neutral-500">
        {label}
      </div>
    </div>
  );
}
