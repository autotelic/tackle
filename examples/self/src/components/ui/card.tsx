import type { ReactNode } from "react"

/*
 * A primitive too. `cutlist` reads the destructured props (`title`, `children`) and the
 * tags it renders; `plumb-ui` reads the `pnpm` classes against the token vocabulary, which
 * is why every colour below is a token and not a hex.
 */

export interface CardProps {
  readonly title: string
  readonly children?: ReactNode
}

/** The surface everything else sits on. */
export function Card({ title, children }: CardProps) {
  return (
    <section className="rounded-lg border border-border bg-background p-4">
      <h2 className="text-sm font-medium text-foreground">{title}</h2>
      {children}
    </section>
  )
}
