import { Button } from "./ui/button.tsx"
import { Card } from "./ui/card.tsx"
import { useTheme } from "./use-theme.ts"

/*
 * Shared: two route owners import it, so it does not belong to either one. This is the
 * tier the whole ownership pass exists to compute — `first-segment` collapses
 * `dashboard_.$id` and `dashboard_.$id.sponsors` to the single domain `dashboard`, so the
 * component is shared between `dashboard` and `settings` rather than owned by four pages.
 */

export interface ProjectToolbarProps {
  readonly title: string
}

/** The controls above a project's or the app's content. */
export function ProjectToolbar({ title }: ProjectToolbarProps) {
  const { theme, setTheme } = useTheme()
  return (
    <Card title={title}>
      {theme}
      <Button onClick={() => setTheme(theme === "light" ? "dark" : "light")}>Toggle theme</Button>
    </Card>
  )
}
