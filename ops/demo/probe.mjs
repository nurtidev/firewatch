/**
 * Скриншоты целевых экранов сценария под нужными ролями — проверка перед
 * записью: пустой экран в кадре заметен только постфактум, а перезапись
 * сегмента стоит дороже, чем этот прогон.
 *
 * Запуск:  node ops/demo/probe.mjs
 */
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const WEB = process.env.FW_WEB ?? "http://localhost:3001";
const API = process.env.FW_API ?? "http://localhost:8001";
const OUT = path.resolve("ops/demo/out/probe");
const SIZE = { width: 1920, height: 1080 };

const TARGETS = [
  ["supervisor", "/map"],
  ["supervisor", "/model"],
  ["inspector", "/routes"],
  ["supervisor", "/cards"],
  ["dispatcher", "/dispatch"],
  ["responder", "/callout"],
  ["supervisor", "/forces"],
  ["supervisor", "/infra"],
  ["supervisor", "/dashboard"],
];

const USER = { inspector: "inspector", supervisor: "supervisor", leadership: "minister",
  dispatcher: "dispatcher", responder: "responder", admin: "admin" };

async function login(role) {
  const u = USER[role];
  const res = await fetch(`${API}/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: u, password: `${u}123` }),
  });
  if (!res.ok) throw new Error(`login ${u}: ${res.status}`);
  return res.json();
}

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();

for (const [role, route] of TARGETS) {
  const { token, user } = await login(role);
  const ctx = await browser.newContext({ viewport: SIZE, locale: "ru-RU" });
  await ctx.addInitScript(([t, u]) => {
    localStorage.setItem("fw_token", t);
    localStorage.setItem("fw_user", u);
  }, [token, JSON.stringify(user)]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 120)));
  await page.goto(`${WEB}${route}`, { waitUntil: "networkidle", timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(4_000);
  const name = `${role}${route.replace(/\//g, "-")}.png`;
  await page.screenshot({ path: path.join(OUT, name) });
  console.log(`✓ ${name}${errors.length ? `  ⚠ console: ${errors[0]}` : ""}`);
  await ctx.close();
}

await browser.close();
console.log(`\nСкриншоты: ${OUT}`);
