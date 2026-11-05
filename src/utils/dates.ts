/** Dates are ISO strings (YYYY-MM-DD); timestamps are SQLite UTC text. SAST is UTC+2 (no DST). */

export function today(): string {
  return sastDate(new Date());
}

export function sastDate(date: Date): string {
  const shifted = new Date(date.getTime() + 2 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

export function addDays(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function addMonths(dateIso: string, months: number): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

export function monthStart(dateIso: string): string {
  return `${dateIso.slice(0, 7)}-01`;
}

export function monthEnd(dateIso: string): string {
  const d = new Date(`${dateIso.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

export function isValidDateRange(start: string, end: string): boolean {
  return start <= end;
}
