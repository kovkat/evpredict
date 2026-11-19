"""Median DC station power in the Open Charge Map Ukraine snapshot (fallback P_def).

Usage: python research/params/dc_power.py  ->  research/params/results/dc_power.json
"""
import json, pathlib, statistics

root = pathlib.Path(__file__).resolve().parents[1]
st = json.loads((root / "stations" / "data" / "ua_stations.json").read_text())
dc = [s for s in st if s["dc"]]
kw = [s["maxKw"] for s in dc if s["maxKw"] > 0]
q = statistics.quantiles(kw, n=4)
out = {"source": "Open Charge Map, Ukraine snapshot (research/stations/data/ua_stations.json)",
       "dc_stations": len(dc), "with_power": len(kw),
       "median_kw": statistics.median(kw), "q25_kw": q[0], "q75_kw": q[2]}
(pathlib.Path(__file__).parent / "results" / "dc_power.json").write_text(json.dumps(out, indent=1) + "\n")
print(out)
