import type { ReactNode } from "react"

/*
 * A primitive: the lowest tier, imported by everything and importing nothing above it.
 * Raw interactive elements are legal here and nowhere else — that is what
 * `allowPaths: ["src/components/ui"]` in `.oxlintrc.json` is buying.
 */

export interface ButtonProps {
  readonly variant?: "default" | "outline" | "ghost"
  readonly size?: "sm" | "md"
  readonly onClick?: () => void
  readonly children?: ReactNode
}

const classes: Record<NonNullable<ButtonProps["variant"]>, string> = {
  default: "bg-primary text-background",
  outline: "border border-border bg-background text-foreground",
  ghost: "hover:bg-muted",
}

/** The one `<button>` in the app. Everything interactive composes this. */
export function Button({ variant = "default", size = "md", onClick, children }: ButtonProps) {
  return (
    <button
      className={`rounded-md ${classes[variant]} ${size === "sm" ? "h-8 px-3" : "h-10 px-4"}`}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
