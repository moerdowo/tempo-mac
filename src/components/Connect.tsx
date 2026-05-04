import { useEffect, useState } from 'react'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { openUrl } from '@tauri-apps/plugin-opener'
import type { CliInfo } from '../lib/wallet'

const INSTALL_CMD = 'curl -fsSL https://tempo.xyz/install | bash'

export function Connect({
  cli,
  busy,
  onConnect,
  error,
}: {
  cli: CliInfo | null
  busy: boolean
  onConnect: () => void
  error: string | null
}) {
  const [log, setLog] = useState<string[]>([])
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let off: UnlistenFn | undefined
    listen<string>('cli:log', (event) => {
      setLog((prev) => [...prev.slice(-100), event.payload])
    })
      .then((fn) => {
        off = fn
      })
      .catch(() => {})
    return () => {
      off?.()
    }
  }, [])

  if (!cli?.installed) {
    return (
      <div>
        <h1>Welcome to Tempo</h1>
        <p className="sub">
          This Mac app uses the official Tempo CLI for signing — your passkey stays in
          your browser, just like <code>tempo wallet login</code> in the terminal.
        </p>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Install Tempo CLI</h2>
          <p className="sub" style={{ fontSize: 12, marginBottom: 12 }}>
            One-line install. After it finishes, click "I've installed it" below.
          </p>
          <pre className="code" style={{ marginBottom: 12 }}>{INSTALL_CMD}</pre>
          <div className="row" style={{ gap: 8 }}>
            <button
              className="ghost"
              onClick={() => {
                navigator.clipboard.writeText(INSTALL_CMD)
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              }}
            >
              {copied ? 'Copied' : 'Copy command'}
            </button>
            <button
              className="ghost"
              onClick={() => void openUrl('https://docs.tempo.xyz/wallet/install')}
            >
              Open docs ↗
            </button>
            <button className="primary" onClick={() => window.location.reload()}>
              I've installed it
            </button>
          </div>
        </div>
        {error && <div className="error">{error}</div>}
      </div>
    )
  }

  return (
    <div>
      <h1>Connect Tempo Wallet</h1>
      <p className="sub">
        Click below — your default browser will open the Tempo Wallet sign-in page.
        After you complete the passkey, the app continues automatically.
      </p>
      <div className="card">
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 6 }}>
          Tempo CLI {cli.version ?? 'detected'}
        </div>
        <button className="primary" onClick={onConnect} disabled={busy}>
          {busy ? 'Waiting for browser sign-in…' : 'Sign in with Tempo Wallet'}
        </button>
        <p className="sub" style={{ marginTop: 14, marginBottom: 0, fontSize: 11.5 }}>
          The CLI generates a scoped, expiring access key authorised by your passkey.
          Your wallet's root key never leaves the browser.
        </p>

        {log.length > 0 && (
          <>
            <h2 style={{ marginTop: 20 }}>CLI output</h2>
            <pre className="code" style={{ maxHeight: 220 }}>
              {log.join('\n')}
            </pre>
          </>
        )}
      </div>
      {error && <div className="error">{error}</div>}
    </div>
  )
}
