// Наскрізні сценарії користувача (Playwright). Запуск: зібрати клієнт, запустити імітацію Open-Meteo
// (node ../api-server/test/fake-open-meteo.mjs 5055) і сервер з OPEN_METEO_URL=http://127.0.0.1:5055, потім
//   BASE_URL=http://localhost:5000 node e2e/smoke.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const pw = (await import(process.env.PLAYWRIGHT_MODULE ?? "playwright")).default;
const b = await pw.chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1.5, acceptDownloads: true });
const p = await ctx.newPage(); const errs = [];
p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
const SHOTS = process.env.SHOTS_DIR ?? "e2e/shots"; mkdirSync(SHOTS, { recursive: true });
const B = process.env.BASE_URL ?? "http://127.0.0.1:5000"; const res = [];
const t = async (name, fn) => { try { await fn(); res.push(["PASS", name]); } catch (e) { res.push(["FAIL", name, e.message.split("\n")[0]]); } };
const num = (s) => parseFloat(String(s).replace(",", ".").replace("−", "-"));
const email = `e2e-${Date.now()}@example.com`, password = "e2e-password";

await t("Е1 без входу застосунок відкриває сторінку входу", async () => {
  await p.goto(B + "/prediction"); await p.waitForURL(/\/login$/); await p.waitForSelector("text=Увійдіть в EVPredict");
  await p.screenshot({ path: `${SHOTS}/login.png` });
});
await t("Е2 реєстрація: різні паролі → повідомлення, потім успішна реєстрація", async () => {
  await p.click("[data-testid=link-auth-switch]"); await p.waitForURL(/\/register$/);
  await p.fill("[data-testid=input-auth-name]", "Тестовий водій"); await p.fill("[data-testid=input-auth-email]", email);
  await p.fill("[data-testid=input-auth-password]", password); await p.fill("[data-testid=input-auth-confirm-password]", "other-password");
  await p.click("[data-testid=button-auth-submit]"); await p.waitForSelector("[data-testid=text-auth-error] >> text=не збігаються");
  await p.fill("[data-testid=input-auth-confirm-password]", password); await p.click("[data-testid=button-auth-submit]");
  await p.waitForURL(/\/dashboard$/); await p.waitForSelector("text=Вітаємо, Тестовий водій");
});
await t("Е3 прогноз без автомобіля → підказка обрати модель", async () => {
  await p.click("[data-testid=link-nav-prediction]"); await p.waitForSelector("text=Автомобіль не обрано");
});
await t("Е4 вибір автомобіля з довідника і SoH, некоректний SoH блокує збереження", async () => {
  await p.click("[data-testid=link-nav-vehicle]"); await p.waitForSelector("[data-testid=select-vehicle-model] option[value=fiat-500e-2013]", { state: "attached" });
  await p.selectOption("[data-testid=select-vehicle-model]", "fiat-500e-2013"); await p.fill("[data-testid=input-vehicle-soh]", "20");
  if (!(await p.isDisabled("[data-testid=button-save-vehicle]"))) throw new Error("not disabled");
  await p.fill("[data-testid=input-vehicle-soh]", "88"); await p.screenshot({ path: `${SHOTS}/vehicle.png` });
  await p.click("[data-testid=button-save-vehicle]"); await p.waitForSelector("[data-testid=text-vehicle-label]");
  if (!(await p.textContent("[data-testid=text-header-vehicle]")).includes("Fiat 500e")) throw new Error("header");
});
await t("Е5 прогноз фізичної моделі з поясненням і «що буде, якщо»", async () => {
  await p.click("[data-testid=link-nav-prediction]"); await p.waitForSelector("[data-testid=chart-contributions]");
  await p.waitForSelector("[data-testid=table-what-if] tbody tr");
  await p.waitForTimeout(400); await p.screenshot({ path: `${SHOTS}/forecast-physics.png`, fullPage: true });
});
await t("Е6 зміна швидкості миттєво змінює прогноз", async () => {
  const before = await p.textContent("[data-testid=text-forecast-energy]");
  await p.fill("[data-testid=input-speed-highway]", "130"); await p.waitForTimeout(900);
  const after = await p.textContent("[data-testid=text-forecast-energy]");
  if (before === after) throw new Error(`${before} = ${after}`);
  await p.fill("[data-testid=input-speed-highway]", "110"); await p.waitForTimeout(700);
});
await t("Е7 поїздка, на яку не вистачить заряду → попередження", async () => {
  await p.fill("[data-testid=input-km-highway]", "160"); await p.waitForTimeout(900);
  const s = await p.textContent("[data-testid=text-forecast-status]"); if (!s.includes("не вистачить")) throw new Error(s);
  await p.screenshot({ path: `${SHOTS}/forecast-insufficient.png` });
  await p.fill("[data-testid=input-km-highway]", "70"); await p.waitForTimeout(700);
});
await t("Е8 некоректна поїздка (0 км) → зрозуміле повідомлення", async () => {
  for (const r of ["city", "highway"]) await p.fill(`[data-testid=input-km-${r}]`, "0");
  await p.waitForSelector("[data-testid=text-forecast-error]");
  await p.fill("[data-testid=input-km-city]", "8"); await p.fill("[data-testid=input-km-highway]", "70"); await p.waitForTimeout(700);
});
await t("Е8а температура з прогнозу погоди для міста і часу виїзду", async () => {
  await p.click("[data-testid=button-weather-open]"); await p.waitForSelector("[data-testid=select-weather-city] option[value=lviv]", { state: "attached" });
  await p.selectOption("[data-testid=select-weather-city]", "lviv"); await p.click("[data-testid=button-weather-load]");
  await p.waitForSelector("[data-testid=text-weather-note] >> text=Львів");
  const v = await p.inputValue("[data-testid=input-temp]"); if (v === "-5") throw new Error("temp not replaced");
});
await t("Е9 ручне додавання поїздки і відхилення некоректного SoC", async () => {
  await p.click("[data-testid=link-nav-trips]"); await p.click("[data-testid=button-add-trip]"); await p.waitForSelector("[data-testid=table-trips] tbody tr");
  await p.fill("[data-testid=input-trip-socEnd]", "95"); await p.click("[data-testid=button-add-trip]");
  const m = await p.textContent("[data-testid=text-trips-message]"); if (!m.includes("має бути меншим")) throw new Error(m);
});
await t("Е10 генерація 40 поїздок «динамічного» водія і навчання k", async () => {
  await p.selectOption("[data-testid=select-sim-profile]", "dynamic"); await p.fill("[data-testid=input-sim-count]", "40");
  await p.click("[data-testid=button-generate-trips]"); await p.waitForSelector("text=Додано 40 змодельованих поїздок");
  await p.waitForTimeout(1200);
  const k = num(await p.textContent("[data-testid=text-summary-k]"));
  if (!(k > 1.05)) throw new Error("k=" + k);
  await p.screenshot({ path: `${SHOTS}/trips.png`, fullPage: true });
});
await t("Е11 історія зберігається в базі: після перезавантаження сторінки поїздки на місці", async () => {
  await p.waitForTimeout(800); await p.reload(); await p.waitForSelector("[data-testid=table-trips] tbody tr");
  const n = await p.locator("[data-testid=table-trips] tbody tr").count(); if (n !== 41) throw new Error("rows " + n);
});
await t("Е12 персоналізований прогноз використовує k", async () => {
  await p.click("[data-testid=link-nav-prediction]"); await p.waitForSelector("text=Персоналізовано");
  await p.waitForTimeout(900); await p.screenshot({ path: `${SHOTS}/forecast-personal.png`, fullPage: true });
  const s = await p.textContent("[data-testid=chart-contributions]"); if (!s.includes("Ваш стиль водіння")) throw new Error("no personal row");
});
await t("Е13 експорт історії в CSV та імпорт після очищення дають той самий k", async () => {
  await p.click("[data-testid=link-nav-trips]"); await p.waitForSelector("[data-testid=text-trips-k]");
  const before = (await p.textContent("[data-testid=text-trips-k]")).trim();
  if (!before.startsWith("k =")) throw new Error("no history: " + before);
  const [dl] = await Promise.all([p.waitForEvent("download"), p.click("[data-testid=button-export-csv]")]);
  const file = `${SHOTS}/trips.csv`; await dl.saveAs(file);
  const lines = readFileSync(file, "utf8").trim().split("\n");
  if (!lines[0].startsWith("date,km_city")) throw new Error("header " + lines[0]);
  await p.click("[data-testid=button-clear-trips]"); await p.waitForSelector("text=Поїздок ще немає");
  await p.setInputFiles("[data-testid=input-import-csv]", file);
  await p.waitForSelector(`[data-testid=text-trips-message] >> text=Імпортовано ${lines.length - 1}`);
  await p.waitForFunction(() => document.querySelector("[data-testid=text-trips-k]")?.textContent?.startsWith("k ="));
  const after = (await p.textContent("[data-testid=text-trips-k]")).trim();
  if (after !== before) throw new Error(`${before} ≠ ${after}`);
});
await t("Е14 батарея: запас ходу за моделлю і фактичне споживання", async () => {
  await p.click("[data-testid=link-nav-battery]"); await p.waitForSelector("[data-testid=table-range] tbody tr");
  await p.waitForSelector("[data-testid=chart-consumption] svg"); await p.waitForTimeout(500);
  const v = await p.textContent("[data-testid=text-metric-cycles]"); if (!(num(v) > 0)) throw new Error(v);
  await p.screenshot({ path: `${SHOTS}/battery.png`, fullPage: true });
});
await t("Е15 профіль водія: k, коефіцієнти за типами доріг, σ", async () => {
  await p.click("[data-testid=link-nav-behavior]"); await p.waitForSelector("[data-testid=list-road-factors]");
  const k = num(await p.textContent("[data-testid=text-metric-k]")); if (!(k > 1.05)) throw new Error("k " + k);
  const s = num(await p.textContent("[data-testid=text-metric-sigma]")); if (!(s >= 1)) throw new Error("sigma " + s);
  await p.waitForTimeout(400); await p.screenshot({ path: `${SHOTS}/behavior.png`, fullPage: true });
});
await t("Е16 моделі: крива навчання, експеримент і реєстр параметрів", async () => {
  await p.click("[data-testid=link-nav-models]"); await p.waitForSelector("[data-testid=chart-learning] svg");
  if ((await p.locator("[data-testid=table-benchmark] tbody tr").count()) < 3) throw new Error("benchmark");
  if (!(await p.textContent("[data-testid=table-weather-benchmark]")).includes("З прогнозом і рельєфом")) throw new Error("weather benchmark");
  const all = await p.locator("[data-testid=table-params] tbody tr").count();
  await p.selectOption("[data-testid=select-param-group]", "reliability");
  const rel = await p.locator("[data-testid=table-params] tbody tr").count(); if (!(rel > 0 && rel < all)) throw new Error(`${rel}/${all}`);
  await p.screenshot({ path: `${SHOTS}/models.png`, fullPage: true });
});
await t("Е17 огляд показує автомобіль, поїздки і похибку", async () => {
  await p.click("[data-testid=link-nav-dashboard]"); await p.waitForTimeout(1000);
  const v = await p.textContent("[data-testid=text-metric-mape]"); if (!v.includes("%")) throw new Error(v);
  await p.screenshot({ path: `${SHOTS}/dashboard.png` });
});
await t("Е18 зарядні станції поблизу зі знімка реєстру з надійністю", async () => {
  await p.click("[data-testid=link-nav-charging]"); await p.waitForSelector("[data-testid=list-stations] > div");
  await p.check("[data-testid=checkbox-dc-only]"); await p.waitForTimeout(700); await p.waitForSelector("[data-testid=list-stations] > div");
  await p.screenshot({ path: `${SHOTS}/charging.png`, fullPage: true });
});
await t("Е19 маршрут: авто без DC-заряджання → пояснення", async () => {
  await p.click("[data-testid=link-nav-routes]"); await p.waitForSelector("[data-testid=text-route-no-dc]");
});
await t("Е19а власна точка заряду: авто без DC доїжджає Київ → Житомир через неї", async () => {
  await p.click("[data-testid=link-nav-charging]"); await p.waitForSelector("[data-testid=own-stations]");
  for (const [title, coords] of [["Дача", "50.38 29.90"], ["Батьки", "50,32, 29,28"]]) {
    await p.fill("[data-testid=input-own-title]", title); await p.fill("[data-testid=input-own-coords]", coords);
    await p.click("[data-testid=button-own-add]"); await p.waitForSelector(`[data-testid=list-own-stations] >> text=${title}`);
  }
  // ≈ 164 км дорогою для 21 кВт·год батареї – лише із заряджанням у дорозі
  await p.click("[data-testid=link-nav-routes]"); await p.selectOption("[data-testid=select-to]", "zhytomyr");
  await p.fill("[data-testid=input-route-soc]", "100");
  await p.waitForSelector("[data-testid=card-evpredict] [data-testid=text-own-stop]");
  if (!/Дача|Батьки/.test(await p.textContent("[data-testid=card-evpredict]"))) throw new Error("own stop title");
  await p.screenshot({ path: `${SHOTS}/route-own-station.png`, fullPage: true });
  await p.selectOption("[data-testid=select-to]", "lviv"); await p.fill("[data-testid=input-route-soc]", "90");
  await p.click("[data-testid=link-nav-charging]");
  for (let i = 0; i < 2; i++) { await p.click("[data-testid=list-own-stations] button >> nth=0"); await p.waitForTimeout(400); }
  await p.waitForSelector("[data-testid=list-own-stations]", { state: "detached" });
});
await t("Е20 маршрут Київ → Львів: EVPredict проти простого планувальника, збереження плану", async () => {
  await p.click("[data-testid=link-nav-vehicle]"); await p.click("[data-testid=button-edit-vehicle]");
  await p.selectOption("[data-testid=select-vehicle-model]", "nissan-leaf-40"); await p.fill("[data-testid=input-vehicle-soh]", "88");
  await p.click("[data-testid=button-save-vehicle]"); await p.waitForSelector("text=Nissan Leaf 40 kWh");
  await p.click("[data-testid=link-nav-routes]"); await p.waitForSelector("[data-testid=card-evpredict] ol li");
  const c = await p.textContent("[data-testid=text-route-conditions]");
  if (!c.includes("У розрахунку") || !c.includes("Рельєф: Київ")) throw new Error("conditions: " + c);
  if (!(await p.textContent("[data-testid=cold-start-note]")).includes("σ = 1,32")) throw new Error("cold-start note");
  await p.screenshot({ path: `${SHOTS}/route-weather.png`, fullPage: true });
  await p.uncheck("[data-testid=checkbox-route-weather]"); await p.waitForSelector("[data-testid=input-route-temp]");
  await p.fill("[data-testid=input-route-temp]", "-5"); await p.waitForTimeout(1500);
  if (!(await p.textContent("[data-testid=text-route-conditions]")).includes("задана вручну")) throw new Error("manual temp");
  await p.waitForSelector("[data-testid=text-route-summary]");
  if (!(await p.isVisible("[data-testid=text-baseline-warning]"))) throw new Error("no baseline warning");
  await p.click("[data-testid=button-save-route]"); await p.waitForSelector("[data-testid=list-saved-routes] li");
  await p.screenshot({ path: `${SHOTS}/route-kyiv-lviv.png`, fullPage: true });
});
await t("Е21 маршрут: однакові міста → повідомлення", async () => {
  await p.selectOption("[data-testid=select-to]", "kyiv"); await p.waitForSelector("[data-testid=text-route-error]");
  await p.selectOption("[data-testid=select-to]", "odesa"); await p.waitForSelector("[data-testid=text-route-summary]");
});
await t("Е22 мобільна ширина: прогноз і батарея без горизонтальної прокрутки", async () => {
  const m = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, storageState: await ctx.storageState() }); const mp = await m.newPage();
  for (const path of ["/prediction", "/battery"]) {
    await mp.goto(B + path); await mp.waitForSelector(path === "/prediction" ? "[data-testid=chart-contributions]" : "[data-testid=table-range]"); await mp.waitForTimeout(500);
    const w = await mp.evaluate(() => document.documentElement.scrollWidth); await mp.screenshot({ path: `${SHOTS}/mobile${path.replace("/", "-")}.png`, fullPage: true });
    if (w > 392) throw new Error(`${path} scrollWidth ${w}`);
  }
  await m.close();
});
await t("Е23 вихід і повторний вхід: дані на місці", async () => {
  await p.click("[data-testid=link-nav-profile]"); await p.click("[data-testid=button-logout]"); await p.waitForURL(/\/login$/);
  await p.fill("[data-testid=input-auth-email]", email); await p.fill("[data-testid=input-auth-password]", "wrong-password");
  await p.click("[data-testid=button-auth-submit]"); await p.waitForSelector("[data-testid=text-auth-error]");
  await p.fill("[data-testid=input-auth-password]", password); await p.click("[data-testid=button-auth-submit]"); await p.waitForURL(/\/dashboard$/);
  if (!(await p.textContent("[data-testid=text-header-vehicle]")).includes("Nissan Leaf")) throw new Error("vehicle lost");
});
await t("Е24 видалення облікового запису", async () => {
  await p.click("[data-testid=link-nav-profile]"); await p.click("[data-testid=button-delete-account]"); await p.click("[data-testid=button-confirm-delete]");
  await p.waitForURL(/\/login$/);
  await p.fill("[data-testid=input-auth-email]", email); await p.fill("[data-testid=input-auth-password]", password);
  await p.click("[data-testid=button-auth-submit]"); await p.waitForSelector("[data-testid=text-auth-error]");
});
console.log(res.map((r) => r.join(" | ")).join("\n")); writeFileSync(`${SHOTS}/results.txt`, res.map((r) => r.join(" | ")).join("\n"));
// очікувані відповіді 401 під час перевірки сеансу і неправильного пароля не є помилками застосунку
console.log("other errors:", errs.filter((e) => !e.includes("401")));
await b.close();
if (res.some((r) => r[0] === "FAIL")) process.exit(1);
