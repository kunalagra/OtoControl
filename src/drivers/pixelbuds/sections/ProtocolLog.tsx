import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { PixelBudsDevice, ProtocolLogEntry } from '../device'

interface Props {
  device: PixelBudsDevice
  connected: boolean
}

const hex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ')

/** One line per entry, timed from the first: what "Copy log" puts on the clipboard. */
function formatLog(entries: readonly ProtocolLogEntry[]): string {
  const start = entries[0]?.at ?? 0
  return entries
    .map((entry) => `+${entry.at - start}ms ${entry.direction === 'connect' ? '-- connect --' : `${entry.direction.toUpperCase()} ${hex(entry.bytes)}`}`)
    .join('\n')
}

/**
 * The raw conversation with the earbuds, for reporting a pair that misbehaves: bytes as
 * they crossed the link, so a reply the decoder drops still shows. Sending is limited to
 * the read-only queries `PixelBudsDevice.sendQuery` accepts (software, hardware, read <id>).
 */
export function ProtocolLog({ device, connected }: Props) {
  const subscribe = useCallback((listener: () => void) => device.onProtocolLog(listener), [device])
  const snapshot = useCallback(() => device.protocolLog, [device])
  const entries = useSyncExternalStore(subscribe, snapshot, snapshot)
  const [input, setInput] = useState('')
  const [result, setResult] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const node = logRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [entries])

  async function send() {
    try {
      setResult(`Reply: ${await device.sendQuery(input)}`)
    } catch (cause) {
      setResult(cause instanceof Error ? cause.message : String(cause))
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(formatLog(device.protocolLog))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setResult('Could not copy — select the log text instead.')
    }
  }

  return (
    <Card data-size="sm">
      <CardHeader>
        <CardTitle>Protocol log</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div
          ref={logRef}
          className="bg-muted/40 border-border h-56 overflow-auto rounded-lg border p-3 font-mono text-[11px] select-text"
        >
          {entries.length === 0 ? (
            <p className="text-muted-foreground">Nothing yet — connect to start recording.</p>
          ) : (
            entries.map((entry, index) =>
              entry.direction === 'connect' ? (
                <p key={index} className="text-muted-foreground py-0.5">
                  — connect —
                </p>
              ) : (
                <div key={index} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-2 py-0.5">
                  <span className={cn('font-bold', entry.direction === 'tx' ? 'text-signal-strong' : 'text-emerald-500')}>
                    {entry.direction.toUpperCase()}
                  </span>
                  <code className="break-all">{hex(entry.bytes)}</code>
                </div>
              ),
            )
          )}
        </div>

        <div className="flex gap-2">
          <input
            value={input}
            placeholder="read 13"
            aria-label="Read-only query"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void send()
            }}
            className="border-input bg-background focus-visible:ring-ring min-w-0 flex-1 rounded-md border px-3 py-1.5 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          />
          <Button size="sm" variant="outline" disabled={!connected} onClick={() => void send()}>
            Send
          </Button>
          <Button size="sm" variant="ghost" disabled={entries.length === 0} onClick={() => void copy()}>
            {copied ? 'Copied' : 'Copy log'}
          </Button>
        </div>

        {result && <p className="text-muted-foreground font-mono text-xs break-all">{result}</p>}
      </CardContent>
    </Card>
  )
}
