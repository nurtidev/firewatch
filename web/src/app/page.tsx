import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col justify-between p-10">
      <header className="text-xs tracking-widest text-neutral-500">
        FW · ИНТЕЛЛЕКТУАЛЬНАЯ ПЛАТФОРМА
      </header>

      <div>
        <h1 className="text-7xl font-bold tracking-tight">
          FireWatch<span style={{ color: "var(--fw-accent)" }}>.</span>
        </h1>
        <p className="mt-4 max-w-xl text-lg text-neutral-400">
          Предиктивная аналитика пожарной безопасности. Каждое здание Казахстана
          — под наблюдением модели.
        </p>
        <div className="mt-8 flex gap-3">
          <Link
            href="/map"
            className="inline-block rounded-md px-5 py-3 text-sm font-medium text-black"
            style={{ background: "var(--fw-accent)" }}
          >
            Карта риска →
          </Link>
          <Link
            href="/cards"
            className="inline-block rounded-md border border-neutral-700 px-5 py-3 text-sm font-medium text-neutral-200 hover:bg-neutral-900"
          >
            Оперкарточки (ИИ) →
          </Link>
          <Link
            href="/routes"
            className="inline-block rounded-md border border-neutral-700 px-5 py-3 text-sm font-medium text-neutral-200 hover:bg-neutral-900"
          >
            План инспекций →
          </Link>
          <Link
            href="/infra"
            className="inline-block rounded-md border border-neutral-700 px-5 py-3 text-sm font-medium text-neutral-200 hover:bg-neutral-900"
          >
            Инфраструктура →
          </Link>
        </div>
      </div>

      <footer className="text-xs tracking-widest text-neutral-600">
        FIREWATCH × ДЧС РК · ПИЛОТ: АСТАНА
      </footer>
    </main>
  );
}
