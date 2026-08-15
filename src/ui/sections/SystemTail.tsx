import type { ReactNode } from 'react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { FEATURE_NAMES, unsupportedFeatures } from '@/core/profiles'
import type { DeviceProfile } from '@/core/profiles'
import { About } from './About'

/**
 * Features the connected model has that this app cannot drive yet.
 *
 * Shown rather than hidden: "your headphones do this, we have not written it"
 * is a useful thing to know, and silently omitting it makes the app look like
 * it has covered everything. Nothing renders for a model we have no profile
 * for, since then we have no basis for the claim.
 */
function MissingFeatures({ profile }: { profile: DeviceProfile | null }) {
  const missing = profile ? unsupportedFeatures(profile) : []
  if (missing.length === 0) return null

  return (
    <Card data-size="sm">
      <CardHeader>
        <CardTitle>Not supported yet</CardTitle>
        <p className="text-muted-foreground text-xs">
          Your {profile!.name} has these. This app cannot control them — the protocol for
          them has not been written.
        </p>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-1.5">
          {missing.map((feature) => (
            <span
              key={feature}
              className="border-border text-muted-foreground rounded-full border border-dashed px-2.5 py-1 text-xs"
            >
              {FEATURE_NAMES[feature]}
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

interface SystemTailProps {
  /**
   * The Advanced card — the debug console and anything else that is about the
   * app rather than the device. Omitted on brands that have none.
   */
  advanced?: ReactNode
  /** The "Reported capabilities" card for this brand. */
  capabilities: ReactNode
  /**
   * The connected model's profile, for the not-supported-yet list, or null
   * when nothing has identified itself or no profile matches.
   *
   * A profile rather than the `brand` + `model` pair this used to take: only
   * `MissingFeatures` ever wanted them, and only to call `profileFor` and get
   * exactly this back. Taking the answer instead of the lookup keys is what
   * lets a shared component stop naming brands at all — each driver's own
   * System section supplies its own profile.
   */
  profile: DeviceProfile | null
}

/**
 * The end of every System page, in one place.
 *
 * Order is deliberate and shared across brands: everything device-specific
 * comes first in the page body, then **Advanced, then Reported capabilities,
 * then About** — narrowing from "your headphones" to "this app". Each brand
 * page rendering its own tail let the order drift apart, so it lives here.
 */
export function SystemTail({ advanced, capabilities, profile }: SystemTailProps) {
  return (
    <>
      <MissingFeatures profile={profile} />
      {advanced}
      {capabilities}
      <About />
    </>
  )
}
