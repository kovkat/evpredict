import { CarFront, Check, Pencil, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { EmptyState, KeyValues, Notice, PageHeader, SelectField, Surface } from "@/components/kit";
import { saveVehicle, useVehicle } from "@/lib/storage";
import { useCatalog } from "@/lib/use-energy";
import { fmt } from "@/lib/format";

export function VehiclePage() {
  const vehicle = useVehicle();
  const { data: catalog, error } = useCatalog();
  const [editing, setEditing] = useState(false);
  const [vehicleId, setVehicleId] = useState("");
  const [soh, setSoh] = useState("100");
  const [saveError, setSaveError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (vehicle) { setVehicleId(vehicle.vehicleId); setSoh(String(vehicle.sohPct)); }
  }, [vehicle]);

  const selected = catalog.find((c) => c.id === vehicleId);
  const sohNum = Number(soh);
  const sohValid = soh.trim() !== "" && Number.isFinite(sohNum) && sohNum >= 40 && sohNum <= 100;
  const showForm = editing || !vehicle;

  const save = async () => {
    if (!selected || !sohValid) return;
    setBusy(true); setSaveError("");
    try {
      await saveVehicle({ vehicleId: selected.id, label: `${selected.make} ${selected.model}`, sohPct: sohNum, usableKWh: selected.usableKWh });
      setEditing(false);
    } catch (e) { setSaveError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="animate-enter">
      <PageHeader title="Автомобіль" description="Модель автомобіля і стан батареї. Від них залежать маса, аеродинаміка і доступна ємність у моделі споживання." />

      {vehicle && !editing && (
        <Surface className="mb-5 p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))]"><Check size={18} /></span>
              <div>
                <div data-testid="text-vehicle-label" className="text-[14px] font-bold">{vehicle.label}</div>
                <div className="text-[11px] text-dim">
                  Стан батареї {fmt(vehicle.sohPct, 0)} % · доступна ємність {fmt((vehicle.usableKWh * vehicle.sohPct) / 100)} з {fmt(vehicle.usableKWh)} кВт·год
                </div>
              </div>
            </div>
            <button type="button" className="action-secondary" data-testid="button-edit-vehicle" onClick={() => setEditing(true)}>
              <Pencil size={14} /> Змінити
            </button>
          </div>
        </Surface>
      )}

      {showForm && (
        <Surface className="p-5 md:p-7">
          {error && <div className="mb-5"><Notice tone="error">{error}</Notice></div>}
          {!catalog.length && !error ? (
            <EmptyState icon={CarFront} title="Завантаження довідника" detail="Отримуємо список підтримуваних моделей." />
          ) : (
            <>
              <div className="grid gap-5 md:grid-cols-2">
                <SelectField label="Модель" id="vehicle-model" value={vehicleId} onChange={setVehicleId}>
                  <option value="">Оберіть модель</option>
                  {catalog.map((c) => (
                    <option key={c.id} value={c.id}>{c.make} {c.model} ({c.years})</option>
                  ))}
                </SelectField>
                <label className="block">
                  <span className="label">Стан батареї (SoH), %</span>
                  <input id="vehicle-soh" data-testid="input-vehicle-soh" type="number" min={40} max={100} value={soh}
                    onChange={(e) => setSoh(e.target.value)} className="field" />
                  <span className="mt-1 block text-[10px] text-dim">Зі звіту діагностики батареї або сервісного застосунку для вашої моделі.</span>
                </label>
              </div>

              {selected && (
                <div className="mt-6">
                  <KeyValues rows={[
                    ["Корисна ємність", `${fmt(selected.usableKWh)} кВт·год`],
                    ["Маса з водієм", `${selected.massKg} кг`],
                    ["Коефіцієнт опору", fmt(selected.cd, 3)],
                    ["Заряджання", `${selected.connectors.join(", ")} · ${selected.maxDcKw ? `до ${selected.maxDcKw} кВт DC` : "лише змінний струм"}`],
                  ]} />
                </div>
              )}

              <div className="mt-7 flex flex-wrap gap-3 border-t border-[hsl(var(--border))] pt-5">
                <button type="button" className="action-primary" data-testid="button-save-vehicle" disabled={!selected || !sohValid || busy} onClick={() => void save()}>
                  <Save size={14} /> Зберегти
                </button>
                {vehicle && (
                  <button type="button" className="action-secondary" onClick={() => setEditing(false)}>Скасувати</button>
                )}
                {!sohValid && <span className="self-center text-[11px] text-[hsl(var(--destructive))]">Стан батареї має бути від 40 до 100 %.</span>}
              </div>
              {saveError && <div className="mt-3"><Notice tone="error">{saveError}</Notice></div>}
              <p className="mt-4 text-[10px] leading-5 text-dim">
                Параметри моделей узято з відкритих технічних характеристик. Фактичне споживання саме вашого автомобіля система уточнює за історією поїздок.
              </p>
            </>
          )}
        </Surface>
      )}
    </div>
  );
}
