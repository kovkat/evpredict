// Обласні центри та великі міста України (координати центрів, наближено)
export interface City { id: string; name: string; nameEn: string; lat: number; lon: number; elevM: number; }

// Висоти над рівнем моря, м: Copernicus DEM GLO-90 через Elevation API Open-Meteo, 18.11.2026 (research/stations/elevation.ts)
export const UA_CITIES: City[] = [
  ["kyiv", "Київ", "Kyiv", 50.4501, 30.5234, 155], ["lviv", "Львів", "Lviv", 49.8397, 24.0297, 280], ["odesa", "Одеса", "Odesa", 46.4825, 30.7233, 61],
  ["kharkiv", "Харків", "Kharkiv", 49.9935, 36.2304, 125], ["dnipro", "Дніпро", "Dnipro", 48.4647, 35.0462, 60], ["zhytomyr", "Житомир", "Zhytomyr", 50.2547, 28.6587, 225],
  ["vinnytsia", "Вінниця", "Vinnytsia", 49.2331, 28.4682, 267], ["poltava", "Полтава", "Poltava", 49.5883, 34.5514, 166], ["sumy", "Суми", "Sumy", 50.9077, 34.7981, 143],
  ["chernihiv", "Чернігів", "Chernihiv", 51.4982, 31.2893, 129], ["uman", "Умань", "Uman", 48.7484, 30.2218, 218], ["rivne", "Рівне", "Rivne", 50.6199, 26.2516, 189],
  ["ternopil", "Тернопіль", "Ternopil", 49.5535, 25.5948, 319], ["khmelnytskyi", "Хмельницький", "Khmelnytskyi", 49.4229, 26.9871, 291],
  ["cherkasy", "Черкаси", "Cherkasy", 49.4444, 32.0598, 112], ["kropyvnytskyi", "Кропивницький", "Kropyvnytskyi", 48.5079, 32.2623, 110],
  ["mykolaiv", "Миколаїв", "Mykolaiv", 46.975, 31.9946, 22], ["zaporizhzhia", "Запоріжжя", "Zaporizhzhia", 47.8388, 35.1396, 84],
  ["ivano-frankivsk", "Івано-Франківськ", "Ivano-Frankivsk", 48.9226, 24.7111, 261], ["lutsk", "Луцьк", "Lutsk", 50.7472, 25.3254, 195],
  ["chernivtsi", "Чернівці", "Chernivtsi", 48.2921, 25.9358, 240], ["uzhhorod", "Ужгород", "Uzhhorod", 48.6208, 22.2879, 118],
].map(([id, name, nameEn, lat, lon, elevM]) => ({ id, name, nameEn, lat, lon, elevM }) as City);

/** Середні місячні температури для Києва, °C (наближено) */
export const KYIV_MONTH_TEMP = [-4, -3, 2, 9, 15, 19, 21, 20, 15, 9, 3, -2];
