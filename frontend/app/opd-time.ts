export const calledTime = new Intl.DateTimeFormat(undefined, {
  timeZone: "Asia/Colombo",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  timeZoneName: "short",
});
const opdDateFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Colombo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function todayOpdDate() {
  return opdDateFormat.format(new Date());
}
