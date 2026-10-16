import { ProjectToolbar } from "../components/project-toolbar.tsx"
import { Card } from "../components/ui/card.tsx"

/*
 * A flat-file route. Its name is dotted, so its domain is the segment before the dot —
 * the same `dashboard` as `dashboard_.$id.tsx`, which is exactly why a component imported
 * by both reads as owned by one domain instead of two.
 */

/** The sponsors tab of a project. */
export function DashboardProjectSponsors() {
  return (
    <Card title="Sponsors">
      <ProjectToolbar title="Sponsor controls" />
    </Card>
  )
}
