export function calendarDay(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function dailyCron(schedule: string): string {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(schedule)) throw new Error('Invalid schedule');
  const [hour, minute] = schedule.split(':').map(Number);
  return `${minute} ${hour} * * *`;
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
