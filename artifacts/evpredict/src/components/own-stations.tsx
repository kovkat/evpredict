// Власні точки заряду користувача: дім, знайома розетка, станція, якої немає у відкритому реєстрі.
// Планувальник маршрутів додає їх до станцій реєстру, якщо вони лежать у коридорі пошуку.
import { Home, MapPinned, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { num } from "@workspace/energy";
import { Field, Notice, NumberInput, SelectField, Surface } from "@/components/kit";
import { apiFetch } from "@/lib/api";
import { fmt } from "@/lib/format";

export interface OwnStation { id: number; title: string; lat: number; lon: number; maxKw: number; dc: boolean }

/** «50.4501, 30.5234» (як копіює Google Maps), «50,4501 30,5234» або «50.45;30.52» */
export function parseCoords(s: string): { lat: number; lon: number } | null {
  const m = s.trim().match(/^(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1].replace(",", ".")), lon = Number(m[2].replace(",", "."));
  return lat >= 44 && lat <= 53 && lon >= 22 && lon <= 41 ? { lat, lon } : null;
}

export function OwnStations({ maxAcKw, maxDcKw }: { maxAcKw?: number; maxDcKw?: number }) {
  const [list, setList] = useState<OwnStation[]>([]);
  const [title, setTitle] = useState("");
  const [coords, setCoords] = useState("");
  const [kw, setKw] = useState("7.4");
  const [kind, setKind] = useState<"ac" | "dc">("ac");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { apiFetch<OwnStation[]>("/me/stations").then(setList).catch((e: Error) => setError(e.message)); }, []);

  const fromLocation = () => {
    setError("");
    if (!navigator.geolocation) return setError("Браузер не підтримує визначення місцезнаходження.");
    navigator.geolocation.getCurrentPosition(
      (p) => setCoords(`${p.coords.latitude.toFixed(5)}, ${p.coords.longitude.toFixed(5)}`),
      () => setError("Доступ до місцезнаходження не надано. Вставте координати вручну."),
    );
  };

  const add = async () => {
    setError("");
    const c = parseCoords(coords), power = Number(kw.replace(",", "."));
    if (!title.trim()) return setError("Вкажіть назву точки.");
    if (!c) return setError("Вкажіть координати в межах України, наприклад 50.4501, 30.5234.");
    if (!(power >= 1 && power <= 400)) return setError("Потужність має бути від 1 до 400 кВт.");
    setBusy(true);
    try {
      const row = await apiFetch<OwnStation>("/me/stations", { method: "POST", json: { title: title.trim(), ...c, maxKw: power, dc: kind === "dc" } });
      setList((l) => [...l, row]); setTitle(""); setCoords("");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const remove = async (id: number) => {
    setError("");
    try { await apiFetch(`/me/stations/${id}`, { method: "DELETE" }); setList((l) => l.filter((s) => s.id !== id)); }
    catch (e) { setError((e as Error).message); }
  };

  return (
    <Surface className="h-fit p-5 md:p-6" data-testid="own-stations">
      <div className="mb-5 flex items-center gap-3"><Home size={17} className="text-[hsl(var(--primary))]" /><h2 className="text-[15px] font-bold">Мої точки заряду</h2></div>
      <div className="grid gap-4">
        <Field label="Назва" id="own-title" placeholder="Дача, батьки, робота" value={title} onChange={setTitle} />
        <Field label="Координати" id="own-coords" placeholder="50.4501, 30.5234" value={coords} onChange={setCoords} />
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="Струм" id="own-kind" value={kind} onChange={(v) => setKind(v as "ac" | "dc")}>
            <option value="ac">Змінний (AC)</option>
            <option value="dc">Постійний (DC)</option>
          </SelectField>
          <NumberInput id="own-kw" label="Потужність" unit="кВт" value={kw} onChange={setKw} />
        </div>
        <span className="-mt-2 text-[10px] leading-4 text-dim">Розетка 230 В, 10 А – 2,3 кВт; настінна станція – 7,4 кВт (32 А), трифазна – 11 або 22 кВт.</span>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <button type="button" className="action-primary" data-testid="button-own-add" disabled={busy} onClick={() => void add()}>Додати точку</button>
        <button type="button" className="action-secondary" data-testid="button-own-location" onClick={fromLocation}><MapPinned size={14} />Я зараз тут</button>
      </div>
      {error && <div className="mt-4"><Notice tone="error" testId="text-own-error">{error}</Notice></div>}
      {list.length > 0 && (
        <div className="mt-5 divide-y divide-[hsl(var(--border))] rounded-md border border-[hsl(var(--border))]" data-testid="list-own-stations">
          {list.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="truncate text-[12px] font-bold">{s.title}</div>
                <div className="mt-0.5 font-mono text-[10px] text-dim">{fmt(s.lat, 4)}, {fmt(s.lon, 4)} · {fmt(s.maxKw, 1)} кВт {s.dc ? "DC" : "AC"}</div>
              </div>
              <button type="button" className="shrink-0 text-dim hover:text-[hsl(var(--destructive))]" aria-label={`Видалити ${s.title}`} data-testid={`button-own-delete-${s.id}`} onClick={() => void remove(s.id)}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      )}
      <div className="mt-5">
        <Notice>
          Власних точок немає у відкритому реєстрі, тому планувальник вважає їх робочими (надійність {fmt(num("ownStationReliability") * 100, 0)} %) і використовує,
          якщо точка лежить у коридорі маршруту. Потужність AC обмежує бортовий зарядний пристрій
          {maxAcKw ? ` вашого автомобіля – ${fmt(maxAcKw, 1)} кВт` : " автомобіля"}{maxDcKw === 0 ? "; DC-точки цей автомобіль не використовує" : ""}.
        </Notice>
      </div>
    </Surface>
  );
}
