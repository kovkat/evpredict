"""Підготовка реальних поїздок електромобілів і PHEV з набору Vehicle Energy Dataset (VED).

Для кожної поїздки, де працював лише електропривод, обчислюється енергія з батареї
(інтегрування U·I за часом) і агреговані ознаки поїздки.
Запуск: python research/ved/prepare.py <каталог з VED_*_week.csv> <VED_Static_Data_PHEV&EV.xlsx>
"""
import glob, sys
import numpy as np
import pandas as pd

src, static_xlsx = sys.argv[1], sys.argv[2]
out = sys.argv[3] if len(sys.argv) > 3 else "research/ved/data/ved_ev_trips.csv"
static = pd.read_excel(static_xlsx)
ev_ids = set(static.VehId)

cols = ["DayNum", "VehId", "Trip", "Timestamp(ms)", "Latitude[deg]", "Longitude[deg]", "Vehicle Speed[km/h]",
        "Engine RPM[RPM]", "Fuel Rate[L/hr]", "OAT[DegC]", "Air Conditioning Power[Watts]", "Air Conditioning Power[kW]",
        "Heater Power[Watts]", "HV Battery Current[A]", "HV Battery SOC[%]", "HV Battery Voltage[V]"]
parts = []
for f in sorted(glob.glob(f"{src}/VED_*_week.csv")):
    for chunk in pd.read_csv(f, usecols=cols, chunksize=2_000_000):
        parts.append(chunk[chunk.VehId.isin(ev_ids)])
    print("read", f, file=sys.stderr)
df = pd.concat(parts, ignore_index=True)
# pandas повертає колонки в порядку файлу, а не usecols, тому перейменовуємо за назвами
df = df.rename(columns=dict(zip(cols, ["day", "veh", "trip", "t_ms", "lat", "lon", "speed", "rpm", "fuel", "oat",
                                      "ac_w", "ac_kw", "heater_w", "i", "soc", "u"])))
df = df.sort_values(["veh", "trip", "t_ms"])


def trip_features(g: pd.DataFrame):
    g = g.copy()
    for c in ["i", "u", "soc", "oat"]:
        g[c] = g[c].interpolate(limit_direction="both")
    if g["i"].isna().all() or g["u"].isna().all():
        return None
    t = g.t_ms.to_numpy() / 1000.0
    dt = np.diff(t, append=t[-1])
    dt = np.clip(dt, 0, 5)                                  # розриви запису не інтегруємо
    v = g.speed.fillna(0).to_numpy() / 3.6
    p_kw = (g.u * g.i).to_numpy() / 1000.0
    # у VED струм розряду від'ємний, тому енергія з батареї = −∫U·I dt
    energy_kwh = -np.nansum(p_kw * dt) / 3600.0
    dist_km = np.sum(v * dt) / 1000.0
    engine_on = bool((g.rpm > 300).any() or (g.fuel > 0.1).any())  # PHEV: будь-яка робота ДВЗ
    moving = v > 1
    acc = np.diff(v, prepend=v[0]) / np.where(dt > 0, dt, 1)
    stops = int(np.sum((v[1:] < 0.5) & (v[:-1] >= 0.5)))
    ac = g.ac_w.fillna(0)
    return dict(
        veh=int(g.veh.iloc[0]), trip=int(g.trip.iloc[0]), day=float(g.day.iloc[0]),
        duration_min=(t[-1] - t[0]) / 60, dist_km=dist_km, energy_kwh=energy_kwh,
        soc_start=g.soc.iloc[0], soc_end=g.soc.iloc[-1],
        v_mean_moving=float(np.mean(v[moving]) * 3.6) if moving.any() else 0.0,
        v_std=float(np.std(v[moving]) * 3.6) if moving.any() else 0.0,
        v_max=float(np.max(v) * 3.6), idle_share=float(1 - moving.mean()),
        stops_per_km=stops / max(dist_km, 0.1),
        acc_pos_mean=float(np.mean(acc[acc > 0.1])) if (acc > 0.1).any() else 0.0,
        share_highway=float(np.mean(v[moving] * 3.6 > 80)) if moving.any() else 0.0,
        oat=float(g.oat.mean()) if g.oat.notna().any() else np.nan,
        ac_kw=float(ac.mean() / 1000), heater_kw=float(g.heater_w.fillna(0).mean() / 1000),
        engine_on=bool(engine_on),
    )


rows = [r for _, g in df.groupby(["veh", "trip"]) if (r := trip_features(g)) is not None]
trips = pd.DataFrame(rows).merge(static[["VehId", "EngineType", "Generalized_Weight"]], left_on="veh", right_on="VehId").drop(columns="VehId")
trips.to_csv(out, index=False)
print(f"{len(trips)} trips, {trips.veh.nunique()} vehicles -> {out}", file=sys.stderr)
