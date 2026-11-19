"""Mass, drag coefficient and frontal area of the catalogue vehicles, each value with its source.

mass_kg = curb weight (manufacturer, without driver) + 75 kg driver
          (driver mass in "mass in running order", Commission Regulation (EU) No 1230/2012, Art. 2(4)).
area_m2 = 0.85 · width (without mirrors) · height: projected frontal area is "typically ~85% of width x height"
          (Pannone G., Technical Analysis of Vehicle Load Reduction Potential for Advanced Clean Cars,
          CONTROLTEC for CARB, contract 13-313, 2015, Table V, p. 14). No manufacturer publishes frontal area
          for these models.
Base trim (lightest) is used where curb weight differs by trim.
  python -I research/params/vehicle_specs.py   ->  research/params/results/vehicle_specs.json
"""
import json, pathlib

DRIVER_KG = 75
AREA_FACTOR = 0.85

SRC = {
    "fiat_media": "Stellantis (FCA US) Media, «2013 Fiat 500e: Design», 27.11.2012 – Cd 0,311",
    "fiat_spec": "FIAT USA, All-new 2013 FIAT 500e Specifications, 04.2013 (копія на fiat500usa.com) – маса, ширина, висота",
    "nissan_2015": "Nissan USA, 2015 Nissan LEAF Press Kit, 27.06.2014 – Cd, маса (S), ширина, висота",
    "nissan_2018": "Nissan USA, 2018 Nissan LEAF Press Kit, 04.12.2017 – Cd, маса (S), ширина, висота",
    "gm_2020": "Chevrolet, 2020 Chevrolet Bolt EV Specifications – маса, ширина, висота",
    "vw_id4": "Volkswagen Newsroom, «The ID.4 – The highlights» – Cd 0,28",
    "evspecs": "EVSpecifications.com (сторінки моделей, звернення 19.11.2026) – значення без первинного документа виробника",
}

# curb_kg, cd, width_mm, height_mm, sources per value
SPECS = {
    "fiat-500e-2013":   dict(curb_kg=1355, cd=0.311, width_mm=1627, height_mm=1527, src=dict(curb="fiat_spec", cd="fiat_media", dims="fiat_spec")),
    "nissan-leaf-24":   dict(curb_kg=1471, cd=0.28,  width_mm=1770, height_mm=1549, src=dict(curb="nissan_2015", cd="nissan_2015", dims="nissan_2015")),
    "nissan-leaf-40":   dict(curb_kg=1557, cd=0.28,  width_mm=1791, height_mm=1560, src=dict(curb="nissan_2018", cd="nissan_2018", dims="nissan_2018")),
    "tesla-model-3-sr": dict(curb_kg=1611, cd=0.23,  width_mm=1849, height_mm=1443, src=dict(curb="evspecs", cd="evspecs", dims="evspecs")),
    "tesla-model-y-lr": dict(curb_kg=1979, cd=0.23,  width_mm=1921, height_mm=1624, src=dict(curb="evspecs", cd="evspecs", dims="evspecs")),
    "chevrolet-bolt":   dict(curb_kg=1616, cd=0.308, width_mm=1765, height_mm=1595, src=dict(curb="gm_2020", cd="evspecs", dims="gm_2020")),
    "kia-niro-ev-64":   dict(curb_kg=1748, cd=0.29,  width_mm=1805, height_mm=1570, src=dict(curb="evspecs", cd="evspecs", dims="evspecs")),
    "vw-id4-77":        dict(curb_kg=2049, cd=0.28,  width_mm=1852, height_mm=1631, src=dict(curb="evspecs", cd="vw_id4", dims="evspecs")),
}

out = {"driverKg": DRIVER_KG, "areaFactor": AREA_FACTOR, "sources": SRC, "vehicles": {}}
for vid, s in SPECS.items():
    out["vehicles"][vid] = {**s, "massKg": s["curb_kg"] + DRIVER_KG,
                            "frontalAreaM2": round(AREA_FACTOR * s["width_mm"] * s["height_mm"] / 1e6, 2)}
    v = out["vehicles"][vid]
    print(f"{vid:18s} m={v['massKg']:5d} cd={v['cd']:.3f} A={v['frontalAreaM2']:.2f}")
path = pathlib.Path(__file__).parent / "results" / "vehicle_specs.json"
path.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n")
