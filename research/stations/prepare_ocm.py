"""Витяг зарядних станцій України з відкритого експорту Open Charge Map (github.com/openchargemap/ocm-export).

Зберігає лише поля, потрібні для оцінки надійності та побудови графа станцій.
Запуск: python research/stations/prepare_ocm.py <каталог ocm-export/data/UA>
"""
import glob, json, os, sys

src = sys.argv[1]
out = os.path.join(os.path.dirname(__file__), "data", "ua_stations.json")
CONN = {2: "CHAdeMO", 25: "Type 2", 1036: "Type 2", 33: "CCS", 32: "CCS", 27: "NACS", 30: "NACS", 1038: "GB/T", 1039: "GB/T"}
rows = []
for f in sorted(glob.glob(os.path.join(src, "*.json"))):
    x = json.load(open(f))
    a = x.get("AddressInfo") or {}
    conns = x.get("Connections") or []
    if a.get("Latitude") is None:
        continue
    comments = x.get("UserComments") or []
    rows.append({
        "id": x["ID"],
        "title": a.get("Title") or "",
        "town": a.get("Town") or "",
        "lat": a["Latitude"], "lon": a["Longitude"],
        "maxKw": max([c.get("PowerKW") or 0 for c in conns] + [0]),
        "dc": any((c.get("CurrentTypeID") == 30) or ((c.get("PowerKW") or 0) >= 25) for c in conns),
        "connectors": sorted({CONN.get(c.get("ConnectionTypeID"), "Other") for c in conns}),
        "points": x.get("NumberOfPoints") or max(1, sum((c.get("Quantity") or 1) for c in conns)),
        "statusTypeId": x.get("StatusTypeID"),
        "operatorId": x.get("OperatorID"),
        "lastVerified": x.get("DateLastVerified") or x.get("DateLastStatusUpdate") or x.get("DateCreated"),
        "dateCreated": x.get("DateCreated"),
        "checkinsOk": sum(1 for c in comments if c.get("CheckinStatusTypeID") == 10),
        "checkinsFailed": sum(1 for c in comments if (c.get("CheckinStatusTypeID") or 0) in range(20, 30)),
    })
json.dump(rows, open(out, "w"), ensure_ascii=False, indent=0)
print(len(rows), "stations ->", out)
