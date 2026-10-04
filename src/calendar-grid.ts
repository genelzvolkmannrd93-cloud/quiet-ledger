export function shiftMonth(month: string, offset: number): string {
  if (!/^\d{4}-\d{2}$/.test(month) || !Number.isInteger(offset)) throw new Error('Invalid calendar month');
  const [year, number] = month.split('-').map(Number);
  if (year < 1000 || year > 9998 || number < 1 || number > 12) throw new Error('Invalid calendar month');
  const date = new Date(Date.UTC(year, number - 1 + offset, 1));
  return date.toISOString().slice(0, 7);
}

// Monday-first grid, with civil dates independent of the browser time zone.
export function monthGrid(month: string): (string | null)[] {
  shiftMonth(month, 0);
  const [year, number] = month.split('-').map(Number);
  const first = new Date(Date.UTC(year, number - 1, 1));
  const padding = (first.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const length = Math.ceil((padding + days) / 7) * 7;
  return Array.from({ length }, (_, index) => {
    const day = index - padding + 1;
    return day < 1 || day > days ? null : `${month}-${String(day).padStart(2, '0')}`;
  });
}
