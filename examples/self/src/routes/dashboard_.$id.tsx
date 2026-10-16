import { useParams } from "@tanstack/react-router"
import { ProjectToolbar } from "../components/project-toolbar.tsx"
import { ThemeProvider } from "../components/theme-provider.tsx"
import { Card } from "../components/ui/card.tsx"

/*
 * A route is an entry point: nothing imports it, by design, so `cutlist` leaves it out of
 * the orphan count. It is here to own components — `first-segment` reads `dashboard` out
 * of `dashboard_.$id`, which is what makes the domain a domain.
 */

/** One project, by id. */
export function DashboardProject() {
  const { id } = useParams({ from: "/dashboard_/$id" })
  return (
    <ThemeProvider>
      <ProjectToolbar title={`Project ${id}`} />
      <Card title="Recent activity">Nothing yet.</Card>
    </ThemeProvider>
  )
}
