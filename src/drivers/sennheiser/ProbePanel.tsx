import { useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Vendor, toHex } from './gaia/frame'
import { knownCommandName } from './gaia/knownCommands'
import { cn } from '@/lib/utils'
import type { ProbeResult } from './client'
import type { MomentumDevice } from './device'

interface Props {
  device: MomentumDevice
  connected: boolean
}

/** Ranges worth sweeping, with what we hope to find in each. */
const SWEEPS = [
  { label: 'User EQ (0x1000–0x101F)', vendor: Vendor.Sennheiser, from: 0x1000, to: 0x101f },
  { label: 'Generic audio (0x0800–0x082F)', vendor: Vendor.Sennheiser, from: 0x0800, to: 0x082f },
  { label: 'Device settings (0x1600–0x161F)', vendor: Vendor.Sennheiser, from: 0x1600, to: 0x161f },
  { label: 'System (0x0400–0x041F)', vendor: Vendor.Sennheiser, from: 0x0400, to: 0x041f },
]

const WAITS = [700, 2000, 5000]

const OUTCOME_LABEL: Record<ProbeResult['outcome'], string> = {
  response: 'implemented',
  error: 'rejected',
  silent: 'no reply',
  blocked: 'blocked',
}

/**
 * Discovery tool. Sends zero-payload requests across a range and reports which
 * command IDs the firmware answers — the way to find features no public source
 * documents.
 */
export function ProbePanel({ device, connected }: Props) {
  const [results, setResults] = useState<ProbeResult[]>([])
  const [running, setRunning] = useState(false)
  const [sweep, setSweep] = useState(0)
  const [showAll, setShowAll] = useState(false)
  const [timeoutMs, setTimeoutMs] = useState(WAITS[0])
  const [copied, setCopied] = useState(false)
  const abort = useRef<AbortController | null>(null)

  async function run() {
    const { vendor, from, to } = SWEEPS[sweep]
    const controller = new AbortController()
    abort.current = controller
    setResults([])
    setRunning(true)
    try {
      await device.probeRange(
        vendor,
        from,
        to,
        (result) => setResults((current) => [...current, result]),
        { timeoutMs, signal: controller.signal },
      )
    } finally {
      setRunning(false)
      abort.current = null
    }
  }

  /** Plain text, so the whole sweep can be pasted somewhere useful. */
  async function copy() {
    const { vendor, label } = SWEEPS[sweep]
    const lines = results.map((result) => {
      const id = `0x${result.command.toString(16).toUpperCase().padStart(4, '0')}`
      const known = knownCommandName(vendor, result.command) ?? 'UNDOCUMENTED'
      const detail = result.payload?.length ? toHex(result.payload) : (result.detail ?? '')
      return `${id}  ${OUTCOME_LABEL[result.outcome].padEnd(12)} ${known.padEnd(38)} ${detail}`
    })
    await navigator.clipboard.writeText([`# ${label}`, ...lines].join('\n'))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const visible = showAll ? results : results.filter((r) => r.outcome === 'response')
  const implemented = results.filter((r) => r.outcome === 'response').length

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          items={SWEEPS.map((entry, index) => ({
            value: String(index),
            label: entry.label,
          }))}
          value={String(sweep)}
          disabled={running}
          onValueChange={(value) => setSweep(Number(value))}
        >
          <SelectTrigger className="w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SWEEPS.map((entry, index) => (
              <SelectItem key={entry.label} value={String(index)}>
                {entry.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          items={WAITS.map((wait) => ({
            value: String(wait),
            label: wait < 1000 ? `${wait}ms wait` : `${wait / 1000}s wait`,
          }))}
          value={String(timeoutMs)}
          disabled={running}
          onValueChange={(value) => setTimeoutMs(Number(value))}
        >
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {WAITS.map((wait) => (
              <SelectItem key={wait} value={String(wait)}>
                {wait < 1000 ? `${wait}ms wait` : `${wait / 1000}s wait`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {running ? (
          <Button size="sm" variant="outline" onClick={() => abort.current?.abort()}>
            Stop
          </Button>
        ) : (
          <Button size="sm" disabled={!connected} onClick={() => void run()}>
            Sweep
          </Button>
        )}

        <Label className="text-muted-foreground ml-auto flex items-center gap-2 text-xs">
          <Switch checked={showAll} onCheckedChange={setShowAll} />
          Show all
        </Label>
      </div>

      <p className="text-muted-foreground text-xs">
        Sends read-only, zero-payload requests one ID at a time.
      </p>

      {results.length > 0 && (
        <div className="flex items-center gap-3">
          <p className="text-sm font-medium">
            {implemented} implemented of {results.length} probed
          </p>
          <Button size="sm" variant="ghost" onClick={() => void copy()}>
            {copied ? 'Copied' : 'Copy results'}
          </Button>
        </div>
      )}

      {visible.length > 0 && (
        <div className="bg-muted/40 border-border max-h-64 overflow-auto rounded-lg border font-mono text-[11px]">
          {visible.map((result) => {
            const known = knownCommandName(SWEEPS[sweep].vendor, result.command)
            return (
              <div
                key={result.command}
                className={cn(
                  'border-border grid grid-cols-[3.5rem_5rem_minmax(0,1fr)] gap-2 border-b px-3 py-1.5 last:border-b-0',
                  result.outcome === 'silent' && 'opacity-55',
                )}
              >
                <code>0x{result.command.toString(16).toUpperCase().padStart(4, '0')}</code>
                <span
                  className={cn(
                    result.outcome === 'response' && 'text-emerald-500',
                    (result.outcome === 'error' || result.outcome === 'blocked') &&
                      'text-destructive',
                  )}
                >
                  {OUTCOME_LABEL[result.outcome]}
                </span>
                <span className="break-all">
                  {known ?? (result.outcome === 'response' ? 'UNDOCUMENTED' : '')}
                </span>
                <code className="text-muted-foreground col-start-3 break-all">
                  {result.payload && result.payload.length > 0
                    ? toHex(result.payload)
                    : (result.detail ?? '')}
                </code>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
