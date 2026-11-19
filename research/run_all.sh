#!/usr/bin/env bash
# Повторює всі експерименти і звітні скрипти. Запуск з кореня репозиторію: bash research/run_all.sh
set -euo pipefail
NODE="node --experimental-strip-types --no-warnings"

python3 research/params/wltc.py > /dev/null
python3 -I research/params/vehicle_specs.py > /dev/null
$NODE research/params/circuity.ts > /dev/null
python3 research/params/dc_power.py > /dev/null
python3 research/params/hvac_fit.py > /dev/null
$NODE research/params/wltc_check.ts > /dev/null
$NODE research/params/physics_sensitivity.ts > /dev/null
# research/params/oed_vehicles.py потребує завантаженого ev-data.json (див. docstring)

$NODE research/calibration/run.ts > /dev/null
python3 research/calibration/ved_check.py > /dev/null
$NODE research/synthetic/run.ts
python3 research/ved/experiment.py
python3 research/params/ved_bias.py > /dev/null

for seed in 2026 2027 2028; do
  $NODE research/benchmark/run.ts 400 $seed
  $NODE research/benchmark/run.ts 400 $seed 0.15
  for tf in 0 1.5 3; do TF=$tf $NODE research/benchmark/run.ts 400 $seed; done
  WORLD=ua $NODE research/benchmark/run.ts 400 $seed
  CORRIDOR=fixed $NODE research/benchmark/run.ts 400 $seed
done
python3 research/benchmark/report.py
python3 research/benchmark/stats.py
python3 research/benchmark/sensitivity.py
python3 research/benchmark/weather_stats.py
python3 research/benchmark/corridor.py

$NODE research/report/numbers.ts
$NODE research/report/params_table.ts
# аналіз чутливості (~1 год на 2 ядрах)
python3 research/sensitivity/run.py 2
STATIONS=diverse python3 research/sensitivity/run.py 2
