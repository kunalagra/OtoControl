import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * Shown on every brand, as the last block on the System page.
 *
 * The disclaimer used to live in the app footer; it belongs somewhere
 * deliberate rather than under every screen.
 */
export function About() {
  return (
    <Card data-size="sm">
      <CardHeader>
        <CardTitle>About</CardTitle>
      </CardHeader>
      <CardContent className="text-muted-foreground flex flex-col gap-2 text-xs">
        <p>
          OtoControl is an unofficial control panel for Bluetooth headphones and earphones, talking to them directly over
          Web Serial. Not affiliated with, or endorsed by, any manufacturer.
        </p>
        <p>
          Sennheiser devices use the Qualcomm GAIA v3 protocol; Sony devices use MDR. Protocol
          knowledge comes from the BudsLink, SmartControl-Desktop, momentumctl and
          sennheiser-desktop-client projects.
        </p>
        <p>
          Values this project has not verified against hardware are listed in
          <code> docs/PROTOCOL-UNKNOWNS.md</code>, along with how to contribute a reading.
        </p>
      </CardContent>
    </Card>
  )
}
