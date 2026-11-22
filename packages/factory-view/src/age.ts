/** The one way this view says how long ago something happened. */
export const formatAge = (minutes: number | null): string => {
  if (minutes === null) return "unknown"
  if (minutes < 1) return "just now"
  if (minutes < 60) return minutes + "m ago"
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return hours + "h " + (minutes % 60) + "m ago"
  return Math.floor(hours / 24) + "d ago"
}
