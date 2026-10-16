import { ProjectToolbar } from "../components/project-toolbar.tsx"
import { ThemeProvider } from "../components/theme-provider.tsx"
import { Card } from "../components/ui/card.tsx"

/*
 * The second domain. It wraps the app in `ThemeProvider` too, so the provider has two
 * owners and lands in `shared` — the alternative was for it to read as a local of
 * whichever page happened to wrap first.
 */

/** Settings. */
export function SettingsPage() {
  return (
    <ThemeProvider>
      <Card title="Settings">
        <ProjectToolbar title="Appearance" />
      </Card>
    </ThemeProvider>
  )
}
