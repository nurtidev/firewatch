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
        <Link
          href="/map"
          className="mt-8 inline-block rounded-md px-5 py-3 text-sm font-medium text-black"
          style={{ background: "var(--fw-accent)" }}
        >
          Открыть карту риска →
        </Link>
      </div>

      <footer className="text-xs tracking-widest text-neutral-600">
        FIREWATCH × ДЧС РК · ПИЛОТ: АСТАНА
      </footer>
    </main>
  );
}
