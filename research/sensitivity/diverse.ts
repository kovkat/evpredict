// Стресовий реєстр станцій для аналізу чутливості: у знімку OCM для України 568 із 572 станцій мають
// статус «працює» і майже немає відгуків, тому частина параметрів індексу надійності там ні на що не впливає.
// Тут розташування, потужність і роз'єми лишаються реальними, а статус, давність перевірки і відгуки
// розігруються (seed фіксований), щоб кожен параметр індексу зачіпав помітну частку станцій.
// Частки умовні й не претендують на опис реальної мережі; мета – активувати всі гілки формули.
import { createRng, type StationRecord } from "../../lib/energy/src/index.ts";

const STATUS: [number | null, number][] = [[50, 0.55], [null, 0.15], [75, 0.1], [30, 0.1], [100, 0.06], [150, 0.04]];

export function diverseStations(stations: StationRecord[], now: Date, seed = 7): StationRecord[] {
  const rng = createRng(seed);
  return stations.map((s) => {
    let u = rng.next(), status: number | null = 50;
    for (const [st, p] of STATUS) { if (u < p) { status = st; break; } u -= p; }
    const never = rng.next() < 0.2;
    const ageYears = rng.next() * 6;
    const ok = rng.next() < 0.3 ? 1 + Math.floor(rng.next() * 4) : 0;
    const failed = rng.next() < 0.2 ? 1 + Math.floor(rng.next() * 2) : 0;
    return { ...s, statusTypeId: status, checkinsOk: ok, checkinsFailed: failed,
      lastVerified: never ? null : new Date(now.getTime() - ageYears * 365.25 * 86400000).toISOString() };
  });
}
