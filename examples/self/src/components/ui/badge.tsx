/*
 * A primitive nothing imports — an orphan, and the reason `cutlist` computes the list: an
 * unused primitive is the cheapest duplicate to have, and the report should say so rather
 * than leave it for a reader to notice.
 */

export interface BadgeProps {
  readonly children?: string
}

/** A status pill. Not used yet. */
export function Badge({ children }: BadgeProps) {
  return <span className="rounded-full border border-border bg-muted px-2 py-0.5">{children}</span>
}
