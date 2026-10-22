const tz = 'Asia/Kolkata';
export const fmtDateTime = (d: string | Date) =>
  new Intl.DateTimeFormat('en-IN', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(d));
export const fmtDate = (d: string | Date) => new Intl.DateTimeFormat('en-IN', { timeZone: tz, dateStyle: 'medium' }).format(new Date(d));
export const fmtTime = (d: string | Date) => new Intl.DateTimeFormat('en-IN', { timeZone: tz, timeStyle: 'short' }).format(new Date(d));
export const todayLocal = () => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
export const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');
