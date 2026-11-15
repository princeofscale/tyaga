/**
 * Часовые пояса для людей: «Саратов, UTC+4», а не `Europe/Saratov`.
 * Идентификатор IANA остаётся значением (он хранится в профиле и настройках), название и смещение — только подпись.
 */
export type TimeZoneChoice = { id: string; label: string };

const CITIES: ReadonlyArray<readonly [string, string]> = [
  ["Europe/Kaliningrad", "Калининград"],
  ["Europe/Moscow", "Москва"],
  ["Europe/Samara", "Самара"],
  ["Europe/Saratov", "Саратов"],
  ["Asia/Yekaterinburg", "Екатеринбург"],
  ["Asia/Omsk", "Омск"],
  ["Asia/Novosibirsk", "Новосибирск"],
  ["Asia/Krasnoyarsk", "Красноярск"],
  ["Asia/Irkutsk", "Иркутск"],
  ["Asia/Yakutsk", "Якутск"],
  ["Asia/Vladivostok", "Владивосток"],
  ["Asia/Magadan", "Магадан"],
  ["Asia/Kamchatka", "Камчатка"],
  ["Europe/Minsk", "Минск"],
  ["Europe/Kyiv", "Киев"],
  ["Asia/Tbilisi", "Тбилиси"],
  ["Asia/Yerevan", "Ереван"],
  ["Asia/Baku", "Баку"],
  ["Asia/Almaty", "Алма-Ата"],
  ["Asia/Tashkent", "Ташкент"],
  ["Asia/Bishkek", "Бишкек"],
  ["Europe/London", "Лондон"],
  ["Europe/Lisbon", "Лиссабон"],
  ["Europe/Madrid", "Мадрид"],
  ["Europe/Paris", "Париж"],
  ["Europe/Berlin", "Берлин"],
  ["Europe/Amsterdam", "Амстердам"],
  ["Europe/Warsaw", "Варшава"],
  ["Europe/Prague", "Прага"],
  ["Europe/Athens", "Афины"],
  ["Europe/Helsinki", "Хельсинки"],
  ["Europe/Istanbul", "Стамбул"],
  ["Asia/Dubai", "Дубай"],
  ["Asia/Jerusalem", "Иерусалим"],
  ["Asia/Bangkok", "Бангкок"],
  ["Asia/Shanghai", "Шанхай"],
  ["Asia/Seoul", "Сеул"],
  ["Asia/Tokyo", "Токио"],
  ["Australia/Sydney", "Сидней"],
  ["America/New_York", "Нью-Йорк"],
  ["America/Chicago", "Чикаго"],
  ["America/Denver", "Денвер"],
  ["America/Los_Angeles", "Лос-Анджелес"],
  ["America/Sao_Paulo", "Сан-Паулу"],
  ["UTC", "Всемирное время"],
];

export class TimeZoneChoices {
  /** «UTC+4», «UTC+5:30», «UTC»; по смещению на `now` (с учётом летнего времени). */
  static offset(zone: string, now = new Date()): string {
    try {
      const part = new Intl.DateTimeFormat("en", { timeZone: zone, timeZoneName: "shortOffset" })
        .formatToParts(now)
        .find((p) => p.type === "timeZoneName")?.value;
      if (!part) return "";
      return part === "GMT" ? "UTC" : part.replace("GMT", "UTC").replace("−", "-");
    } catch {
      return "";
    }
  }

  /** «Саратов, UTC+4»; для пояса вне списка — идентификатор и смещение. */
  static label(zone: string, now = new Date()): string {
    const city = CITIES.find(([id]) => id === zone)?.[1];
    const offset = TimeZoneChoices.offset(zone, now);
    if (zone === "UTC") return "UTC, всемирное время";
    return [city ?? zone, offset].filter(Boolean).join(", ");
  }

  /** Список для выбора; пояс человека и пояс устройства всегда в нём, даже если их нет среди городов. */
  static list(current: string[] = [], now = new Date()): TimeZoneChoice[] {
    const ids = new Set(CITIES.map(([id]) => id));
    const extra = [...new Set(current.filter((zone) => zone && !ids.has(zone) && TimeZoneChoices.offset(zone, now)))];
    return [...extra, ...CITIES.map(([id]) => id)].map((id) => ({ id, label: TimeZoneChoices.label(id, now) }));
  }
}
