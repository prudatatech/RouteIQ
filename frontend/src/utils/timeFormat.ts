export function formatEta(totalMinutes: number): string {
  if (!totalMinutes) return '--';
  const hrs = Math.floor(totalMinutes / 60);
  const mins = Math.round(totalMinutes % 60);
  if (hrs > 0 && mins > 0) return `${hrs} hr ${mins} min`;
  if (hrs > 0) return `${hrs} hr`;
  return `${mins} min`;
}

/** "just now", "5 min ago", "3 hr ago", "2 days ago" for a past timestamp. */
export function formatTimeAgo(date: Date, now: number = Date.now()): string {
  const mins = Math.max(0, Math.floor((now - date.getTime()) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
