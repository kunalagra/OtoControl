import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { frameKind, toHex } from '@/gaia/frame'
import { knownCommandName } from '@/gaia/knownCommands'
import { cn } from '@/lib/utils'
import { ProbePanel } from '../debug/ProbePanel'
import type { SectionProps } from './types'

interface LogLine {
  id: number
  direction: 'tx' | 'rx'
  hex: string
  summary: string
}

const MAX_LINES = 300

export function Debug({ device, state }: SectionProps) {
  const connected = state.status === 'connected'

  return (
    <Card data-size="sm">
      <CardHeader>
        <CardTitle>Debug</CardTitle>
        <p className="text-destructive text-xs">
          Sends raw frames straight to the headphones. Firmware-upgrade, factory-reset and
          paired-device-delete IDs are refused in code and never sent.
        </p>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="log">
          <TabsList>
            <TabsTrigger value="log">Frame log</TabsTrigger>
            <TabsTrigger value="probe">Command sweep</TabsTrigger>
          </TabsList>

          <TabsContent value="log" className="pt-4">
            <FrameLog device={device} connected={connected} />
          </TabsContent>

          <TabsContent value="probe" className="pt-4">
            <ProbePanel device={device} connected={connected} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}

function FrameLog({
  device,
  connected,
}: {
  device: SectionProps['device']
  connected: boolean
}) {
  const [lines, setLines] = useState<LogLine[]>([])
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const nextId = useRef(0)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(
    () =>
      device.onFrame((frame, direction) => {
        const name = knownCommandName(frame.vendor, frame.command)
        const summary =
          `0x${frame.command.toString(16).padStart(4, '0').toUpperCase()} · ` +
          `${frameKind(frame.command)} · ${frame.payload.length}B` +
          (name ? ` · ${name}` : '')
        setLines((current) =>
          [
            ...current,
            { id: nextId.current++, direction, hex: toHex(frame.raw), summary },
          ].slice(-MAX_LINES),
        )
      }),
    [device],
  )

  useEffect(() => {
    const node = logRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [lines])

  async function send() {
    const bytes = input
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean)
      .map((hex) => parseInt(hex, 16))

    if (bytes.length === 0 || bytes.some((b) => Number.isNaN(b) || b < 0 || b > 255)) {
      setError('Enter whitespace-separated hex bytes, e.g. FF 03 00 00 04 95 06 03')
      return
    }
    setError(null)
    try {
      await device.sendRaw(Uint8Array.from(bytes))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        ref={logRef}
        className="bg-muted/40 border-border h-64 overflow-auto rounded-lg border p-3 font-mono text-[11px]"
      >
        {lines.length === 0 ? (
          <p className="text-muted-foreground">No frames yet.</p>
        ) : (
          lines.map((line) => (
            <div key={line.id} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-2 py-0.5">
              <span
                className={cn(
                  'font-bold',
                  line.direction === 'tx' ? 'text-primary' : 'text-emerald-500',
                )}
              >
                {line.direction.toUpperCase()}
              </span>
              <code className="break-all">{line.hex}</code>
              <span className="text-muted-foreground col-start-2 break-all">
                {line.summary}
              </span>
            </div>
          ))
        )}
      </div>

      <div className="flex gap-2">
        <input
          value={input}
          placeholder="FF 03 00 00 04 95 06 03"
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void send()
          }}
          className="border-input bg-background focus-visible:ring-ring min-w-0 flex-1 rounded-md border px-3 py-1.5 font-mono text-xs outline-none focus-visible:ring-2"
        />
        <Button size="sm" variant="outline" disabled={!connected} onClick={() => void send()}>
          Send
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setLines([])}>
          Clear
        </Button>
      </div>

      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  )
}
