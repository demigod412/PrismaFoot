/**
 * Timezones offered in Settings, grouped for the picker.
 * A curated list rather than Intl.supportedValuesOf("timeZone") (~420 entries, most of them
 * aliases): every zone here is one a person might actually be watching football from.
 * Any valid IANA zone still works if it arrives in the cookie — see isTimeZone.
 */
export const TIMEZONE_GROUPS: { group: string; zones: string[] }[] = [
  {
    group: "Africa",
    zones: ["Africa/Lagos", "Africa/Accra", "Africa/Abidjan", "Africa/Dakar", "Africa/Casablanca", "Africa/Algiers",
      "Africa/Tunis", "Africa/Cairo", "Africa/Khartoum", "Africa/Addis_Ababa", "Africa/Nairobi", "Africa/Kampala",
      "Africa/Dar_es_Salaam", "Africa/Kigali", "Africa/Luanda", "Africa/Kinshasa", "Africa/Douala", "Africa/Libreville",
      "Africa/Johannesburg", "Africa/Harare", "Africa/Lusaka", "Africa/Maputo", "Africa/Gaborone", "Africa/Windhoek"],
  },
  {
    group: "Europe",
    zones: ["Europe/London", "Europe/Dublin", "Europe/Lisbon", "Europe/Madrid", "Europe/Paris", "Europe/Brussels",
      "Europe/Amsterdam", "Europe/Berlin", "Europe/Zurich", "Europe/Vienna", "Europe/Rome", "Europe/Copenhagen",
      "Europe/Oslo", "Europe/Stockholm", "Europe/Helsinki", "Europe/Tallinn", "Europe/Riga", "Europe/Vilnius",
      "Europe/Warsaw", "Europe/Prague", "Europe/Bratislava", "Europe/Budapest", "Europe/Ljubljana", "Europe/Zagreb",
      "Europe/Belgrade", "Europe/Sarajevo", "Europe/Skopje", "Europe/Tirane", "Europe/Sofia", "Europe/Bucharest",
      "Europe/Athens", "Europe/Istanbul", "Europe/Kyiv", "Europe/Chisinau", "Europe/Minsk", "Europe/Moscow",
      "Atlantic/Reykjavik", "Asia/Nicosia", "Europe/Malta"],
  },
  {
    group: "North America",
    zones: ["America/St_Johns", "America/Halifax", "America/Toronto", "America/Montreal", "America/New_York",
      "America/Detroit", "America/Chicago", "America/Winnipeg", "America/Mexico_City", "America/Denver",
      "America/Edmonton", "America/Phoenix", "America/Los_Angeles", "America/Vancouver", "America/Anchorage",
      "Pacific/Honolulu"],
  },
  {
    group: "Central & South America",
    zones: ["America/Panama", "America/Bogota", "America/Lima", "America/Guayaquil", "America/Caracas",
      "America/La_Paz", "America/Santiago", "America/Asuncion", "America/Argentina/Buenos_Aires",
      "America/Montevideo", "America/Sao_Paulo", "America/Guatemala", "America/Havana", "America/Santo_Domingo",
      "America/Port_of_Spain"],
  },
  {
    group: "Middle East & Central Asia",
    zones: ["Asia/Jerusalem", "Asia/Beirut", "Asia/Damascus", "Asia/Amman", "Asia/Baghdad", "Asia/Riyadh",
      "Asia/Kuwait", "Asia/Qatar", "Asia/Bahrain", "Asia/Dubai", "Asia/Muscat", "Asia/Tehran", "Asia/Baku",
      "Asia/Tbilisi", "Asia/Yerevan", "Asia/Tashkent", "Asia/Almaty", "Asia/Kabul", "Asia/Karachi"],
  },
  {
    group: "Asia & Pacific",
    zones: ["Asia/Kolkata", "Asia/Colombo", "Asia/Kathmandu", "Asia/Dhaka", "Asia/Yangon", "Asia/Bangkok",
      "Asia/Jakarta", "Asia/Ho_Chi_Minh", "Asia/Kuala_Lumpur", "Asia/Singapore", "Asia/Manila", "Asia/Hong_Kong",
      "Asia/Shanghai", "Asia/Taipei", "Asia/Seoul", "Asia/Tokyo", "Australia/Perth", "Australia/Adelaide",
      "Australia/Brisbane", "Australia/Sydney", "Australia/Melbourne", "Pacific/Auckland", "Pacific/Fiji"],
  },
  { group: "Universal", zones: ["UTC"] },
];

export const ALL_TIMEZONES = TIMEZONE_GROUPS.flatMap((g) => g.zones);
