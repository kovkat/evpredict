// Реєстр параметрів моделей і алгоритмів EVPredict.
//
// Кожне число, що впливає на прогноз або план, має тут одне джерело правди: значення, одиниці
// і походження. Модулі ядра беруть значення лише звідси, а скрипт research/report/params_table.ts
// будує з реєстру таблицю параметрів для пояснювальної записки, тож текст і код не розходяться.
//
// Походження:
//   physical    – фізична стала;
//   regulation  – нормативний документ (посилання в ref);
//   derived     – виведено з властивостей даних або моделі (обґрунтування в note);
//   convention  – загальноприйнята статистична домовленість;
//   definition  – визначення (еталон пояснення, сценарій, типове налаштування користувача),
//                 на точність прогнозу не впливає;
//   provisional – попереднє значення прототипу; поле plan вказує, як його буде обґрунтовано
//                 (literature – літературне джерело, calibration – калібрування на синтетичних
//                 поїздках, sensitivity – аналіз чутливості рекомендацій, road-data – дані
//                 дорожньої мережі).

export type Origin = "physical" | "regulation" | "derived" | "convention" | "definition" | "provisional";
export type Plan = "literature" | "calibration" | "sensitivity" | "road-data";
export type Group =
  | "physics" | "vehicle" | "trip" | "personalization" | "forecast" | "explanation" | "what-if"
  | "reliability" | "graph" | "search" | "charging" | "baseline" | "replanning";

export interface ParamDef {
  symbol: string;
  name: string;
  value: number | readonly number[];
  unit: string;
  group: Group;
  origin: Origin;
  plan?: Plan;
  ref?: string;
  note?: string;
}

const PDR = "Правила дорожнього руху України (постанова КМУ від 10.10.2001 № 1306)";

export const PARAMS = {
  // --- фізика ---
  g: { symbol: "g", name: "прискорення вільного падіння", value: 9.81, unit: "м/с²", group: "physics", origin: "physical" },
  airGasConstant: { symbol: "R_s", name: "питома газова стала сухого повітря", value: 287.05, unit: "Дж/(кг·К)", group: "physics", origin: "physical" },
  airPressure: { symbol: "p", name: "нормальний атмосферний тиск", value: 101325, unit: "Па", group: "physics", origin: "physical" },
  comfortTemp: { symbol: "T_c", name: "температура салону, яку підтримує клімат-система", value: 21, unit: "°C", group: "physics", origin: "provisional", plan: "literature" },

  // --- типові параметри автомобіля (для моделей довідника без власного значення) ---
  rollingResistance: { symbol: "C_rr", name: "коефіцієнт опору коченню", value: 0.0095, unit: "", group: "vehicle", origin: "provisional", plan: "literature" },
  drivetrainEff: { symbol: "η_d", name: "ККД тягового ланцюга", value: 0.88, unit: "", group: "vehicle", origin: "provisional", plan: "literature" },
  regenEff: { symbol: "η_r", name: "ККД рекуперації", value: 0.6, unit: "", group: "vehicle", origin: "provisional", plan: "literature" },
  auxBasePower: { symbol: "P_0", name: "базова потужність допоміжних систем", value: 300, unit: "Вт", group: "vehicle", origin: "provisional", plan: "literature" },
  hvacPerDegree: { symbol: "h", name: "приріст потужності клімат-системи на 1 °C", value: 60, unit: "Вт/°C", group: "vehicle", origin: "provisional", plan: "literature" },
  sohMinPct: { symbol: "SoH_min", name: "нижня межа SoH, яку приймає система", value: 40, unit: "%", group: "vehicle", origin: "definition" },

  // --- типові частини поїздки ---
  citySpeed: { symbol: "v_city", name: "типова швидкість частини поїздки містом", value: 35, unit: "км/год", group: "trip", origin: "provisional", plan: "road-data" },
  suburbanSpeed: { symbol: "v_sub", name: "типова швидкість частини поїздки приміською дорогою", value: 75, unit: "км/год", group: "trip", origin: "provisional", plan: "road-data" },
  highwaySpeed: { symbol: "v_hw", name: "типова швидкість частини поїздки трасою", value: 110, unit: "км/год", group: "trip", origin: "regulation", ref: `${PDR}, п. 12.6: дороги з окремими проїзними частинами` },
  cityStops: { symbol: "n_city", name: "типова кількість зупинок у місті", value: 1.5, unit: "1/км", group: "trip", origin: "provisional", plan: "road-data" },
  suburbanStops: { symbol: "n_sub", name: "типова кількість зупинок на приміській дорозі", value: 0.2, unit: "1/км", group: "trip", origin: "provisional", plan: "road-data" },
  highwayStops: { symbol: "n_hw", name: "кількість зупинок на трасі", value: 0, unit: "1/км", group: "trip", origin: "definition", note: "траса без світлофорів і перехресть" },

  // --- персоналізація ---
  ewmaAlpha: { symbol: "α", name: "коефіцієнт експоненційного згладжування k", value: 0.2, unit: "", group: "personalization", origin: "provisional", plan: "calibration" },
  ratioClip: { symbol: "[k_min; k_max]", name: "межі відношення «факт / модель» при оновленні k", value: [0.5, 2], unit: "", group: "personalization", origin: "provisional", plan: "calibration" },
  minSocDropPct: { symbol: "ΔSoC_min", name: "мінімальне зниження SoC для навчання", value: 5, unit: "п. п.", group: "personalization", origin: "derived",
    note: "покази SoC цілі (крок 1 %), тож похибка різниці до 1 п. п.; за зниження на 5 п. п. похибка фактичної енергії не перевищує 20 %" },
  ridgeLambda: { symbol: "λ", name: "сила стягування k_t до k", value: 4, unit: "", group: "personalization", origin: "provisional", plan: "calibration" },
  roadFactorClip: { symbol: "[k_t,min; k_t,max]", name: "межі коефіцієнтів за типами доріг", value: [0.5, 2], unit: "", group: "personalization", origin: "provisional", plan: "calibration" },

  // --- інтервал прогнозу і запас ---
  intervalMinTrips: { symbol: "J_min", name: "мінімальна історія для інтервалу за квантилями", value: 5, unit: "поїздок", group: "forecast", origin: "provisional", plan: "calibration" },
  defaultInterval: { symbol: "[r_lo; r_hi]", name: "типовий відносний інтервал без історії", value: [0.9, 1.1], unit: "", group: "forecast", origin: "provisional", plan: "calibration" },
  intervalQuantiles: { symbol: "q", name: "квантилі інтервалу прогнозу", value: [0.1, 0.9], unit: "", group: "forecast", origin: "convention",
    ref: "Hyndman R. J., Athanasopoulos G. Forecasting: principles and practice. 3rd ed.", note: "80-відсотковий інтервал прогнозу" },
  intervalMinWidth: { symbol: "[w_lo; w_hi]", name: "мінімальна ширина інтервалу за історією", value: [0.97, 1.03], unit: "", group: "forecast", origin: "provisional", plan: "calibration" },
  safetyMinTrips: { symbol: "J_σ", name: "мінімальна історія для запасу σ", value: 10, unit: "поїздок", group: "forecast", origin: "provisional", plan: "calibration" },
  safetyDefault: { symbol: "σ_0", name: "запас без достатньої історії", value: 1.08, unit: "", group: "forecast", origin: "provisional", plan: "calibration" },
  safetyQuantile: { symbol: "q_σ", name: "квантиль відношень для запасу σ", value: 0.9, unit: "", group: "forecast", origin: "convention", note: "верхня межа 80-відсоткового інтервалу" },
  safetyClip: { symbol: "[σ_min; σ_max]", name: "межі запасу σ", value: [1.03, 1.5], unit: "", group: "forecast", origin: "provisional", plan: "calibration" },
  arriveReserveDefaultPct: { symbol: "s_min", name: "типовий резерв заряду при прибутті", value: 10, unit: "%", group: "forecast", origin: "definition", note: "налаштування користувача" },

  // --- пояснення значеннями Шеплі ---
  referenceSpeed: { symbol: "v_0", name: "еталонна швидкість пояснення", value: 70, unit: "км/год", group: "explanation", origin: "definition", note: "на прогноз не впливає" },
  referenceTemp: { symbol: "T_0", name: "еталонна температура пояснення", value: 20, unit: "°C", group: "explanation", origin: "definition", note: "на прогноз не впливає" },

  // --- сценарії «що буде, якщо» ---
  whatIfHighwayFloor: { symbol: "", name: "нижня межа швидкості в сценарії «повільніше трасою»", value: 90, unit: "км/год", group: "what-if", origin: "regulation", ref: `${PDR}, п. 12.6: інші дороги поза населеними пунктами` },
  whatIfHighwayDrop: { symbol: "", name: "зниження швидкості трасою в сценарії", value: 20, unit: "км/год", group: "what-if", origin: "definition" },
  whatIfSlowerShare: { symbol: "", name: "множник швидкості в сценарії «усі ділянки повільніше»", value: 0.9, unit: "", group: "what-if", origin: "definition" },
  whatIfEcoHvacShare: { symbol: "", name: "множник потужності клімат-системи в економному режимі", value: 0.5, unit: "", group: "what-if", origin: "definition" },
  whatIfClimateDelta: { symbol: "", name: "відхилення від T_c, з якого пропонується економний режим", value: 5, unit: "°C", group: "what-if", origin: "definition" },
  whatIfColdTemp: { symbol: "", name: "температура, нижче якої пропонується денний виїзд", value: 10, unit: "°C", group: "what-if", origin: "definition" },
  whatIfWarmerBy: { symbol: "", name: "потепління в сценарії денного виїзду", value: 6, unit: "°C", group: "what-if", origin: "definition" },

  // --- індекс надійності станцій ---
  relBaseWorking: { symbol: "b(працює)", name: "базове значення: станція працює", value: 0.85, unit: "", group: "reliability", origin: "provisional", plan: "sensitivity" },
  relBasePartial: { symbol: "b(частково)", name: "базове значення: працює частково", value: 0.7, unit: "", group: "reliability", origin: "provisional", plan: "sensitivity" },
  relBaseUnknown: { symbol: "b(невідомо)", name: "базове значення: статус невідомий", value: 0.65, unit: "", group: "reliability", origin: "provisional", plan: "sensitivity" },
  relBaseTemporarilyDown: { symbol: "b(тимчасово)", name: "базове значення: тимчасово недоступна", value: 0.15, unit: "", group: "reliability", origin: "provisional", plan: "sensitivity" },
  relBaseDown: { symbol: "b(не працює)", name: "базове значення: не працює", value: 0.05, unit: "", group: "reliability", origin: "provisional", plan: "sensitivity" },
  relBasePlanned: { symbol: "b(запланована)", name: "базове значення: запланована або виведена з експлуатації", value: 0.02, unit: "", group: "reliability", origin: "provisional", plan: "sensitivity" },
  relAgeYears: { symbol: "a_1, a_2, a_3", name: "межі давності перевірки", value: [1, 2, 4], unit: "роки", group: "reliability", origin: "provisional", plan: "sensitivity" },
  relAgeAdjust: { symbol: "Δ(a)", name: "поправки за давністю: до a_1, до a_2, до a_3, понад a_3", value: [0.05, 0, -0.1, -0.2], unit: "", group: "reliability", origin: "provisional", plan: "sensitivity" },
  relNeverVerified: { symbol: "Δ_0", name: "поправка, якщо станцію не перевіряли", value: -0.1, unit: "", group: "reliability", origin: "provisional", plan: "sensitivity" },
  relCheckinOk: { symbol: "β_ok", name: "внесок одного відгуку «зарядився»", value: 0.03, unit: "", group: "reliability", origin: "provisional", plan: "sensitivity" },
  relCheckinOkMax: { symbol: "Δ_ok", name: "найбільший сумарний внесок відгуків «зарядився»", value: 0.06, unit: "", group: "reliability", origin: "provisional", plan: "sensitivity" },
  relCheckinFail: { symbol: "β_fail", name: "внесок одного відгуку «не вдалося»", value: -0.15, unit: "", group: "reliability", origin: "provisional", plan: "sensitivity" },
  relClip: { symbol: "[ρ_lo; ρ_hi]", name: "межі індексу однієї точки", value: [0.02, 0.97], unit: "", group: "reliability", origin: "provisional", plan: "sensitivity" },
  relSiteMax: { symbol: "ρ_max", name: "верхня межа індексу станції", value: 0.98, unit: "", group: "reliability", origin: "provisional", plan: "sensitivity" },
  relPointsGamma: { symbol: "γ", name: "внесок кожної додаткової точки заряджання", value: 0.5, unit: "", group: "reliability", origin: "provisional", plan: "sensitivity" },
  relPointsMax: { symbol: "n_max", name: "кількість точок, після якої індекс не зростає", value: 4, unit: "", group: "reliability", origin: "provisional", plan: "sensitivity" },

  // --- граф коридору ---
  circuity: { symbol: "κ", name: "коефіцієнт непрямолінійності доріг", value: 1.25, unit: "", group: "graph", origin: "provisional", plan: "road-data" },
  corridorStepsKm: { symbol: "w", name: "ширини коридору пошуку станцій", value: [30, 60, 100], unit: "км", group: "graph", origin: "provisional", plan: "sensitivity" },
  corridorAlongMarginKm: { symbol: "", name: "допуск розташування станції до A і після B", value: 10, unit: "км", group: "graph", origin: "provisional", plan: "sensitivity" },
  minNodeReliability: { symbol: "ρ_excl", name: "мінімальний індекс станції для включення в граф", value: 0.05, unit: "", group: "graph", origin: "provisional", plan: "sensitivity" },
  defaultStationKw: { symbol: "P_def", name: "потужність станції, якщо її не вказано в реєстрі", value: 50, unit: "кВт", group: "graph", origin: "provisional", plan: "literature" },
  highwayEdgeMinKm: { symbol: "l_hw", name: "довжина, з якої ребро вважається трасовим", value: 25, unit: "км", group: "graph", origin: "provisional", plan: "road-data" },
  edgeSpeedHighway: { symbol: "V_hw", name: "швидкість на трасових ребрах", value: 90, unit: "км/год", group: "graph", origin: "regulation", ref: `${PDR}, п. 12.6: інші дороги поза населеними пунктами` },
  edgeSpeedCity: { symbol: "V_city", name: "швидкість на коротких (міських) ребрах", value: 50, unit: "км/год", group: "graph", origin: "regulation", ref: `${PDR}, п. 12.4: населені пункти` },
  edgeStopsHighway: { symbol: "n_hw,e", name: "зупинки на трасових ребрах", value: 0.05, unit: "1/км", group: "graph", origin: "provisional", plan: "road-data" },
  edgeStopsCity: { symbol: "n_city,e", name: "зупинки на міських ребрах", value: 1, unit: "1/км", group: "graph", origin: "provisional", plan: "road-data" },
  maxEdgeKm: { symbol: "", name: "найбільша довжина ребра", value: 700, unit: "км", group: "graph", origin: "derived", note: "перевищує запас ходу будь-якого автомобіля довідника; ребра довші не можуть увійти в план" },
  edgePruneFactor: { symbol: "", name: "множник оптимістичної оцінки споживання для відсікання ребер", value: 0.5, unit: "", group: "graph", origin: "derived", note: "нижня межа споживання; відсікаються лише ребра, недосяжні за будь-яких умов" },

  // --- пошук плану ---
  chargeTargets: { symbol: "Σ", name: "допустимі рівні заряджання", value: [0.5, 0.6, 0.7, 0.8, 0.9], unit: "", group: "search", origin: "provisional", plan: "sensitivity" },
  minChargeIncrement: { symbol: "δ", name: "мінімальний приріст заряду на зупинці", value: 0.05, unit: "", group: "search", origin: "provisional", plan: "sensitivity" },
  socTolerance: { symbol: "ε", name: "допуск порівняння заряду в домінуванні міток", value: 0.005, unit: "", group: "search", origin: "provisional", plan: "sensitivity" },
  minReliability: { symbol: "ρ_min", name: "мінімальний індекс станції для зупинки", value: 0.5, unit: "", group: "search", origin: "provisional", plan: "sensitivity" },
  failurePenaltyH: { symbol: "T_f", name: "очікувана втрата часу, якщо станція не працює", value: 0.75, unit: "год", group: "search", origin: "provisional", plan: "sensitivity" },
  stationArrivalReserve: { symbol: "r", name: "додатковий резерв при прибутті на станцію", value: 0.1, unit: "", group: "search", origin: "provisional", plan: "sensitivity" },
  heuristicSpeed: { symbol: "V_max", name: "швидкість в евристиці A*", value: 90, unit: "км/год", group: "search", origin: "derived", note: "дорівнює найбільшій швидкості на ребрах, тож оцінка не завищує час" },

  // --- заряджання ---
  chargeKnee: { symbol: "s_knee", name: "рівень заряду, після якого потужність знижується", value: 0.8, unit: "", group: "charging", origin: "provisional", plan: "literature" },
  chargeTaper: { symbol: "", name: "частка потужності після s_knee", value: 0.35, unit: "", group: "charging", origin: "provisional", plan: "literature" },
  connectMinutes: { symbol: "", name: "час на під'єднання й оплату", value: 5, unit: "хв", group: "charging", origin: "provisional", plan: "literature" },
  chargeStep: { symbol: "", name: "крок чисельного інтегрування часу заряджання", value: 0.01, unit: "", group: "charging", origin: "derived", note: "відповідає кроку показу SoC" },

  // --- базовий планувальник ---
  baselineSpeed: { symbol: "", name: "швидкість для паспортного питомого споживання", value: 90, unit: "км/год", group: "baseline", origin: "regulation", ref: `${PDR}, п. 12.6` },
  baselineTemp: { symbol: "", name: "температура для паспортного питомого споживання", value: 20, unit: "°C", group: "baseline", origin: "provisional", plan: "literature" },
  baselineChargeTo: { symbol: "", name: "рівень заряджання на кожній зупинці", value: 0.8, unit: "", group: "baseline", origin: "provisional", plan: "literature" },

  // --- перепланування ---
  replanDeviation: { symbol: "Δ_rep", name: "відхилення заряду від плану, що запускає перепланування", value: 0.05, unit: "", group: "replanning", origin: "provisional", plan: "sensitivity" },
  maxReplans: { symbol: "", name: "найбільша кількість перепланувань за поїздку", value: 3, unit: "", group: "replanning", origin: "provisional", plan: "sensitivity" },
} satisfies Record<string, ParamDef>;

export type ParamId = keyof typeof PARAMS;

/** Числове значення параметра */
export const num = (id: ParamId): number => {
  const v = PARAMS[id].value;
  if (typeof v !== "number") throw new Error(`Parameter ${id} is not a scalar`);
  return v;
};

/** Значення параметра-переліку */
export const list = (id: ParamId): number[] => {
  const v = PARAMS[id].value;
  if (typeof v === "number") throw new Error(`Parameter ${id} is not a list`);
  return [...v];
};
