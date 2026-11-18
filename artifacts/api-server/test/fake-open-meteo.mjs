// Імітація сервісу погоди Open-Meteo для тестів без доступу до інтернету.
// Температура: 10 °C мінус градус широти понад 46°; вітер 5 м/с із заходу.
// Особливі широти: ≥ 80 – помилка сервера 500; 60…70 – прогноз без значень (null), архів зі значеннями.
import { createServer } from "node:http";

export const fakeTemp = (lat) => 10 - (lat - 46);

export function startFakeOpenMeteo(port = 0) {
  const calls = { forecast: 0, archive: 0 };
  const server = createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    const send = (code, body) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
    if (u.pathname !== "/v1/forecast" && u.pathname !== "/v1/archive") return send(404, { error: true });
    const kind = u.pathname === "/v1/forecast" ? "forecast" : "archive";
    calls[kind]++;
    const lat = Number(u.searchParams.get("latitude")), day = u.searchParams.get("start_date");
    if (lat >= 80) return send(500, { error: true, reason: "test failure" });
    const empty = kind === "forecast" && lat >= 60 && lat <= 70;
    const time = Array.from({ length: 24 }, (_, h) => `${day}T${String(h).padStart(2, "0")}:00`);
    send(200, { hourly: { time, temperature_2m: time.map(() => (empty ? null : fakeTemp(lat))),
      wind_speed_10m: time.map(() => 5), wind_direction_10m: time.map(() => 270) } });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${server.address().port}`, calls, close: () => server.close() })));
}

// окремий запуск для наскрізних тестів: node test/fake-open-meteo.mjs 5055
if (import.meta.url === `file://${process.argv[1]}`) {
  const f = await startFakeOpenMeteo(Number(process.argv[2] ?? 5055));
  console.log(`fake Open-Meteo at ${f.url}`);
}
