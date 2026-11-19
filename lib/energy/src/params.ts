// Реєстр параметрів моделей і алгоритмів EVPredict.
//
// Кожне число, що впливає на прогноз або план, має тут одне джерело правди: значення, одиниці
// і походження. Модулі ядра беруть значення лише звідси, а скрипт research/report/params_table.ts
// будує з реєстру таблицю параметрів для пояснювальної записки, тож текст і код не розходяться.
//
// Походження:
//   physical    – фізична стала;
//   regulation  – нормативний документ (посилання в ref);
//   literature  – рецензована публікація або звіт державної лабораторії (посилання в ref);
//   derived     – виведено з властивостей даних або моделі (обґрунтування в note);
//   calibrated  – підібрано на синтетичних історіях поїздок і перевірено на реальних поїздках VED
//                 (research/calibration, результат у note);
//   convention  – загальноприйнята статистична домовленість;
//   definition  – визначення (еталон пояснення, сценарій, типове налаштування користувача),
//                 на точність прогнозу не впливає;
//   provisional – значення, для якого немає прямого джерела; поле plan вказує, як його перевірено
//                 (sensitivity – аналіз чутливості рекомендацій, research/sensitivity).
//
// Скрипти, з яких виведено значення origin = derived, лежать у research/params.

export type Origin = "physical" | "regulation" | "literature" | "derived" | "calibrated" | "convention" | "definition" | "provisional";
export type Plan = "sensitivity";
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

const FIORI = "Fiori C., Ahn K., Rakha H. A. Power-based electric vehicle energy consumption model // Applied Energy. 2016. Vol. 168. P. 257–268. DOI 10.1016/j.apenergy.2016.01.097";
const DOE = "U.S. DOE Vehicle Technologies Office. Impact of Cold Ambient Temperature and Extreme Conditions on Electric Vehicles: Program Record, 2024 (дані Argonne APRF)";
const WLTP = "UN GTR № 15 (WLTP), цикл WLTC класу 3b; міський цикл – фази Low і Medium (Регламент (ЄС) 2017/1151, дод. XXI)";
const OED = "Open EV Data (github.com/KilowattApp/open-ev-data), MIT";
const PDR = "Правила дорожнього руху України (постанова КМУ від 10.10.2001 № 1306)";

export const PARAMS = {
  // --- фізика ---
  g: { symbol: "g", name: "прискорення вільного падіння", value: 9.81, unit: "м/с²", group: "physics", origin: "physical" },
  airGasConstant: { symbol: "R_s", name: "питома газова стала сухого повітря", value: 287.05, unit: "Дж/(кг·К)", group: "physics", origin: "physical" },
  airPressure: { symbol: "p", name: "нормальний атмосферний тиск", value: 101325, unit: "Па", group: "physics", origin: "physical" },
  comfortTemp: { symbol: "T_c", name: "температура салону, яку підтримує клімат-система", value: 21, unit: "°C", group: "physics", origin: "literature", ref: "Al-Wreikat Y., Serrano C., Sodré J. R. Effects of ambient temperature and trip characteristics on the energy consumption of an electric vehicle // Energy. 2022. Vol. 238. 122028. DOI 10.1016/j.energy.2021.122028", note: "мінімум питомого споживання реального електромобіля спостерігався близько 21 °C" },

  // --- типові параметри автомобіля (для моделей довідника без власного значення) ---
  rollingResistance: { symbol: "C_rr", name: "коефіцієнт опору коченню", value: 0.0095, unit: "", group: "vehicle", origin: "regulation", ref: "Регламент (ЄС) 2020/740 про маркування шин, дод. I: клас D для шин C1 – 9,1–10,5 Н/кН (вимірювання за UNECE R117)", note: "значення в межах класу D; чутливість перевірено на межах класів B–E" },
  drivetrainEff: { symbol: "η_d", name: "ККД тягового ланцюга (батарея → колесо)", value: 0.84, unit: "", group: "vehicle", origin: "literature", ref: FIORI, note: "добуток ККД трансмісії 0,92 і електродвигуна 0,91; втрати в батареї вже враховано в корисній ємності" },
  regenEff: { symbol: "η_r", name: "ККД рекуперації (колесо → батарея)", value: 0.75, unit: "", group: "vehicle", origin: "derived", ref: FIORI, note: "0,92 · 0,91 · 0,898, де 0,898 – частка рекуперації exp(−0,0411/|a|), зважена за енергією гальмування циклу WLTC 3b (research/params/wltc.py)" },
  auxBasePower: { symbol: "P_0", name: "базова потужність допоміжних систем", value: 185, unit: "Вт", group: "vehicle", origin: "literature", ref: DOE, note: "середнє інших навантажень двох BEV при 22 °C без клімат-системи (research/params/hvac_fit.py)" },
  hvacPerDegree: { symbol: "h", name: "приріст потужності клімат-системи на 1 °C", value: 87, unit: "Вт/°C", group: "vehicle", origin: "derived", ref: DOE, note: "МНК без вільного члена за 8 вимірюваннями при −18…35 °C, RMSE 351 Вт (research/params/hvac_fit.py)" },
  sohMinPct: { symbol: "SoH_min", name: "нижня межа SoH, яку приймає система", value: 40, unit: "%", group: "vehicle", origin: "definition" },

  // --- типові частини поїздки ---
  citySpeed: { symbol: "v_city", name: "типова швидкість частини поїздки містом", value: 34, unit: "км/год", group: "trip", origin: "derived", ref: WLTP, note: "середня швидкість руху без простоїв у міському циклі WLTP (research/params/wltc.py)" },
  suburbanSpeed: { symbol: "v_sub", name: "типова швидкість частини поїздки приміською дорогою", value: 61, unit: "км/год", group: "trip", origin: "derived", ref: WLTP, note: "середня швидкість руху без простоїв у фазі High (research/params/wltc.py)" },
  highwaySpeed: { symbol: "v_hw", name: "типова швидкість частини поїздки трасою", value: 110, unit: "км/год", group: "trip", origin: "regulation", ref: `${PDR}, п. 12.6: дороги з окремими проїзними частинами` },
  cityStops: { symbol: "n_city", name: "розгони з місця на 1 км у місті", value: 4.52, unit: "1/км", group: "trip", origin: "derived", ref: WLTP, note: "еквівалентна кількість розгонів з місця на 1 км: дає ту саму позитивну кінетичну енергію (PKE), що й міський цикл WLTP при v_city: n = PKE·1000/v² (research/params/wltc.py)" },
  suburbanStops: { symbol: "n_sub", name: "розгони з місця на 1 км на приміській дорозі", value: 0.93, unit: "1/км", group: "trip", origin: "derived", ref: WLTP, note: "еквівалентна кількість розгонів з місця на 1 км: дає ту саму позитивну кінетичну енергію (PKE), що й фаза High при v_sub (research/params/wltc.py)" },
  highwayStops: { symbol: "n_hw", name: "розгони з місця на 1 км на трасі", value: 0.27, unit: "1/км", group: "trip", origin: "derived", ref: WLTP, note: "еквівалентна кількість розгонів з місця на 1 км: дає ту саму позитивну кінетичну енергію (PKE), що й фаза Extra-high при v_hw (research/params/wltc.py)" },

  // --- персоналізація ---
  ewmaAlpha: { symbol: "α", name: "коефіцієnt експоненційного згладжування k", value: 0.2, unit: "", group: "personalization", origin: "calibrated", note: "на синтетиці MAPE у межах 0,1 п. п. від найкращої для α = 0,2…0,4; серед них на перевірних авто VED найменша при 0,2 (21,4 % проти 21,8 % при 0,3); на тестових авто VED 25,8 %" },
  ratioClip: { symbol: "[k_min; k_max]", name: "межі відношення «факт / модель» при оновленні k", value: [0.5, 2], unit: "", group: "personalization", origin: "calibrated", note: "запобіжник від помилок введення: на синтетиці й тестових авто VED межі від [0,67; 1,5] і ширші змінюють MAPE не більше ніж на 0,05 п. п.; на тестових авто VED поза межами 4,9 % поїздок" },
  minSocDropPct: { symbol: "ΔSoC_min", name: "мінімальне зниження SoC для навчання", value: 5, unit: "п. п.", group: "personalization", origin: "derived",
    note: "покази SoC цілі (крок 1 %), тож похибка різниці до 1 п. п.; за зниження на 5 п. п. похибка фактичної енергії не перевищує 20 %" },
  ridgeLambda: { symbol: "λ", name: "сила стягування k_t до k", value: 32, unit: "", group: "personalization", origin: "calibrated", note: "мінімум one-step-ahead MAPE на синтетиці (5,64 % проти 5,78 % без коефіцієнтів за типами доріг і 6,10 % без стягування)" },
  roadFactorClip: { symbol: "[k_t,min; k_t,max]", name: "межі коефіцієнтів за типами доріг", value: [0.5, 2], unit: "", group: "personalization", origin: "derived", note: "ті самі межі, що й [k_min; k_max]: k_t – те саме відношення для частини поїздки" },

  // --- інтервал прогнозу і запас ---
  intervalMinTrips: { symbol: "J_min", name: "мінімальна історія для інтервалу за історією", value: 5, unit: "поїздок", group: "forecast", origin: "calibrated", note: "покриття інтервалу на синтетиці 78,6–79,2 % для J = 3…15, тобто довша історія не потрібна" },
  defaultInterval: { symbol: "[r_lo; r_hi]", name: "типовий відносний інтервал без історії", value: [0.82, 1.32], unit: "", group: "forecast", origin: "calibrated", note: "квантилі 0,1 і 0,9 відношення «факт / модель» перших поїздок 120 синтетичних водіїв; на тестових авто VED покриває 53 % поїздок, тому після J_min поїздок замінюється інтервалом за історією" },
  intervalQuantiles: { symbol: "q", name: "квантилі інтервалу прогнозу", value: [0.1, 0.9], unit: "", group: "forecast", origin: "convention",
    ref: "Hyndman R. J., Athanasopoulos G. Forecasting: principles and practice. 3rd ed.; межі – порядкові статистики ⌈(n+1)q⌉ (Lei J. et al. Distribution-free predictive inference for regression // JASA. 2018. Vol. 113. P. 1094–1111)", note: "80-відсотковий інтервал прогнозу; на тестових авто VED фактичне покриття 83,2 %" },
  intervalMinWidth: { symbol: "[w_lo; w_hi]", name: "мінімальна ширина інтервалу за історією", value: [0.97, 1.03], unit: "", group: "forecast", origin: "calibrated", note: "відповідає похибці зчитування SoC з кроком 1 %; на синтетиці додає 0,4 п. п. покриття" },
  safetyMinTrips: { symbol: "J_σ", name: "мінімальна історія для запасу σ", value: 10, unit: "поїздок", group: "forecast", origin: "calibrated", note: "частка поїздок у межах прогноз·σ на синтетиці 86,1–87,3 % для J = 5…20" },
  safetyDefault: { symbol: "σ_0", name: "запас без достатньої історії", value: 1.32, unit: "", group: "forecast", origin: "calibrated", note: "квантиль 0,9 відношення «факт / модель» перших поїздок синтетичних водіїв (r_hi); на тестових авто VED покриває 81,5 % поїздок" },
  safetyQuantile: { symbol: "q_σ", name: "квантиль відношень для запасу σ", value: 0.9, unit: "", group: "forecast", origin: "convention", note: "верхня межа 80-відсоткового інтервалу" },
  safetyClip: { symbol: "[σ_min; σ_max]", name: "межі запасу σ", value: [1.03, 1.5], unit: "", group: "forecast", origin: "calibrated", note: "σ_min – як w_hi; на синтетиці межі не досягаються; на тестових авто VED σ упирається в σ_max у 46 % прогнозів, а частка поїздок у межах прогноз·σ – 92,0 %" },
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
  circuity: { symbol: "κ", name: "коефіцієнт непрямолінійності доріг", value: 1.25, unit: "", group: "graph", origin: "derived", ref: "OSRM, мережа OpenStreetMap (ODbL), 22 обласні центри України", note: "медіана 1,255 (IQR 1,18–1,31) для 462 пар міст (research/params/circuity.ts)" },
  corridorStepsKm: { symbol: "w", name: "ширини коридору пошуку станцій", value: [30, 60, 100], unit: "км", group: "graph", origin: "provisional", plan: "sensitivity" },
  corridorAlongMarginKm: { symbol: "", name: "допуск розташування станції до A і після B", value: 10, unit: "км", group: "graph", origin: "provisional", plan: "sensitivity" },
  minNodeReliability: { symbol: "ρ_excl", name: "мінімальний індекс станції для включення в граф", value: 0.05, unit: "", group: "graph", origin: "provisional", plan: "sensitivity" },
  ownStationReliability: { symbol: "ρ_own", name: "індекс надійності власної точки заряду користувача", value: 1, unit: "", group: "graph", origin: "definition", note: "точку позначає сам користувач і відповідає за її роботу; відкритих даних про неї немає" },
  defaultStationKw: { symbol: "P_def", name: "потужність станції, якщо її не вказано в реєстрі", value: 120, unit: "кВт", group: "graph", origin: "derived", note: "медіана потужності 524 DC-станцій знімка OCM (research/params/dc_power.py)" },
  highwayEdgeMinKm: { symbol: "l_hw", name: "довжина, з якої ребро вважається трасовим", value: 25, unit: "км", group: "graph", origin: "provisional", plan: "sensitivity" },
  edgeSpeedHighway: { symbol: "V_hw", name: "швидкість на трасових ребрах", value: 90, unit: "км/год", group: "graph", origin: "regulation", ref: `${PDR}, п. 12.6: інші дороги поза населеними пунктами` },
  edgeSpeedCity: { symbol: "V_city", name: "швидкість на коротких (міських) ребрах", value: 50, unit: "км/год", group: "graph", origin: "regulation", ref: `${PDR}, п. 12.4: населені пункти` },
  edgeStopsHighway: { symbol: "n_hw,e", name: "розгони з місця на 1 км на трасових ребрах", value: 0.4, unit: "1/км", group: "graph", origin: "derived", ref: WLTP, note: "еквівалентна кількість розгонів з місця на 1 км: дає ту саму позитивну кінетичну енергію (PKE), що й фаза Extra-high при V_hw (research/params/wltc.py)" },
  edgeStopsCity: { symbol: "n_city,e", name: "розгони з місця на 1 км на міських ребрах", value: 2.09, unit: "1/км", group: "graph", origin: "derived", ref: WLTP, note: "еквівалентна кількість розгонів з місця на 1 км: дає ту саму позитивну кінетичну енергію (PKE), що й міський цикл WLTP при V_city (research/params/wltc.py)" },
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
  chargeCurveGeneric: { symbol: "f(s)", name: "частка найбільшої DC-потужності при SoC 0, 10, …, 100 %, якщо крива автомобіля невідома", value: [1, 1, 1, 1, 1, 1, 0.83, 0.67, 0.5, 0.35, 0.2], unit: "", group: "charging", origin: "derived", ref: OED, note: "медіана нормованих кривих 876 автомобілів (research/params/oed_vehicles.py)" },
  connectMinutes: { symbol: "", name: "час на під'єднання й оплату", value: 5, unit: "хв", group: "charging", origin: "provisional", plan: "sensitivity" },
  chargeStep: { symbol: "", name: "крок чисельного інтегрування часу заряджання", value: 0.01, unit: "", group: "charging", origin: "derived", note: "відповідає кроку показу SoC" },

  // --- базовий планувальник ---
  baselineSpeed: { symbol: "", name: "швидкість для паспортного питомого споживання", value: 90, unit: "км/год", group: "baseline", origin: "regulation", ref: `${PDR}, п. 12.6` },
  baselineTemp: { symbol: "", name: "температура для паспортного питомого споживання", value: 23, unit: "°C", group: "baseline", origin: "regulation", ref: "Регламент (ЄС) 2017/1151, дод. XXI, піддод. 6: випробування Type 1 за 23 °C" },
  baselineChargeTo: { symbol: "", name: "рівень заряджання на кожній зупинці", value: 0.8, unit: "", group: "baseline", origin: "definition", note: "правило базового планувальника: заряджати до 80 %, після чого потужність більшості автомобілів падає (див. chargeCurveGeneric)" },

  // --- перепланування ---
  replanDeviation: { symbol: "Δ_rep", name: "відхилення заряду від плану, що запускає перепланування", value: 0.05, unit: "", group: "replanning", origin: "provisional", plan: "sensitivity" },
  maxReplans: { symbol: "", name: "найбільша кількість перепланувань за поїздку", value: 3, unit: "", group: "replanning", origin: "provisional", plan: "sensitivity" },
} satisfies Record<string, ParamDef>;

export type ParamId = keyof typeof PARAMS;

const DEFAULTS = Object.fromEntries(Object.entries(PARAMS).map(([id, p]) => [id, p.value]));

/** Виконує fn зі значеннями реєстру за замовчуванням (без PARAM_OVERRIDES): «справжній» світ симулятора */
export function withDefaultParams<T>(fn: () => T): T {
  const reg = PARAMS as Record<string, ParamDef>, saved = Object.fromEntries(Object.entries(reg).map(([id, p]) => [id, p.value]));
  for (const id in reg) reg[id] = { ...reg[id], value: DEFAULTS[id] };
  try { return fn(); } finally { for (const id in reg) reg[id] = { ...reg[id], value: saved[id] }; }
}

// Аналіз чутливості: PARAM_OVERRIDES='{"connectMinutes": 10}' підміняє значення до того,
// як їх прочитають інші модулі. У браузері змінної немає, і реєстр лишається без змін.
const overrides = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.PARAM_OVERRIDES;
if (overrides) {
  for (const [id, value] of Object.entries(JSON.parse(overrides) as Record<string, number | number[]>)) {
    const p = (PARAMS as Record<string, ParamDef>)[id];
    if (!p) throw new Error(`Unknown parameter in PARAM_OVERRIDES: ${id}`);
    if (Array.isArray(value) !== Array.isArray(p.value)) throw new Error(`PARAM_OVERRIDES: ${id} must be ${Array.isArray(p.value) ? "a list" : "a number"}`);
    (PARAMS as Record<string, ParamDef>)[id] = { ...p, value };
  }
}

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
