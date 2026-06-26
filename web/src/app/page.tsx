"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import { apiFetch, useAuth } from "@/lib/auth";
import { navForRole } from "@/lib/nav";

const MODULE_DESC: Record<string, string> = {
  "/map": "Каждое здание — оценка 0–100, фильтры, карточка с SHAP",
  "/chat": "Запрос на естественном языке → ответ из данных ДЧС",
  "/infra": "Гидранты, части, зоны покрытия и слепые зоны",
  "/routes": "Маршрут на день по приоритету риска и срока",
  "/control": "Выполнение маршрутов инспекторами в реальном времени",
  "/cards": "Скан → извлечение полей → автопредписания",
  "/forces": "Стволы, машины, личный состав, ранг пожара",
};

type Overview = {
  buildings: number;
  high_risk: number;
  mid_risk: number;
  avg_score: number;
  stations: number;
  broken_hydrants: number;
  cards: number;
  prescriptions: number;
  inspectors: number;
};

export default function Home() {
  const { user, ready } = useAuth();
  const router = useRouter();
  const [ov, setOv] = useState<Overview | null>(null);

  // Inspectors don't have a dashboard — send them to their route.
  useEffect(() => {
    if (ready && user?.role === "inspector") router.replace("/routes");
  }, [ready, user, router]);

  useEffect(() => {
    apiFetch(`/overview`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setOv)
      .catch(() => {});
  }, []);

  return (
    <AppShell>
      <div className="p-8">
        <h1 className="text-2xl font-bold">Обзор · Астана</h1>
        <p className="text-sm text-neutral-400">
          Сводка по городу на основе данных ДЧС и модели риска
        </p>

        <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
          <Tile value={ov?.buildings} label="зданий в базе" />
          <Tile value={ov?.high_risk} label="высокий риск" accent />
          <Tile value={ov?.avg_score} label="средний балл риска" />
          <Tile value={ov?.broken_hydrants} label="неисправных гидрантов" accent />
        </div>

        <div className="mt-3 grid grid-cols-2 gap-4 md:grid-cols-4">
          <Tile value={ov?.stations} label="пожарных частей" small />
          <Tile value={ov?.inspectors} label="инспекторов" small />
          <Tile value={ov?.cards} label="обработано карточек" small />
          <Tile value={ov?.prescriptions} label="предписаний выдано" small />
        </div>

        <h2 className="mt-10 text-xs tracking-widest text-neutral-500">
          МОДУЛИ
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {user &&
            navForRole(user.role)
              .filter((n) => n.href !== "/")
              .map((n) => (
                <Card
                  key={n.href}
                  href={n.href}
                  title={n.label}
                  desc={MODULE_DESC[n.href] ?? ""}
                />
              ))}
        </div>
      </div>
    </AppShell>
  );
}

function Tile({
  value,
  label,
  accent,
  small,
}: {
  value: number | undefined;
  label: string;
  accent?: boolean;
  small?: boolean;
}) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
      <div
        className={`font-bold ${small ? "text-2xl" : "text-3xl"}`}
        style={{ color: accent ? "#ff5a1f" : "#fff" }}
      >
        {value == null ? "—" : value.toLocaleString("ru")}
      </div>
      <div className="mt-1 text-[10px] uppercase tracking-widest text-neutral-500">
        {label}
      </div>
    </div>
  );
}

function Card({
  href,
  title,
  desc,
}: {
  href: string;
  title: string;
  desc: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 transition hover:border-neutral-600"
    >
      <div className="font-medium text-neutral-100">{title}</div>
      <div className="mt-1 text-xs text-neutral-500">{desc}</div>
    </Link>
  );
}
