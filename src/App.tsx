import { useCallback, useEffect, useRef, useState } from 'react'
import {
  cliInfo,
  cliLogin,
  cliLogout,
  loadActiveKey,
  type CliInfo,
  type KeyEntry,
  network,
  setNetwork,
} from './lib/wallet'
import { shortAddress } from './lib/format'
import { Wallet } from './components/Wallet'
import { Send } from './components/Send'
import { Services } from './components/Services'
import { History } from './components/History'
import { Connect } from './components/Connect'

type Tab = 'wallet' | 'send' | 'services' | 'history'

const SIDEBAR_KEY = 'tempo-mac:sidebar-width'
const SIDEBAR_MIN = 180
const SIDEBAR_MAX = 480
const SIDEBAR_DEFAULT = 240

function readSidebarWidth(): number {
  const v = Number(localStorage.getItem(SIDEBAR_KEY))
  if (!Number.isFinite(v) || v <= 0) return SIDEBAR_DEFAULT
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, v))
}

function useSidebarWidth(): [number, (px: number) => void, (e: React.PointerEvent) => void] {
  const [width, setWidth] = useState<number>(readSidebarWidth)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-width', `${width}px`)
  }, [width])

  const startDrag = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      dragRef.current = { startX: e.clientX, startWidth: width }
      ;(e.currentTarget as HTMLElement).classList.add('dragging')
      document.body.classList.add('is-resizing')
      let latest = width

      const onMove = (ev: PointerEvent) => {
        if (!dragRef.current) return
        const dx = ev.clientX - dragRef.current.startX
        latest = Math.min(
          SIDEBAR_MAX,
          Math.max(SIDEBAR_MIN, dragRef.current.startWidth + dx),
        )
        setWidth(latest)
      }
      const onUp = () => {
        dragRef.current = null
        document.body.classList.remove('is-resizing')
        document
          .querySelectorAll('.sidebar-resize.dragging')
          .forEach((el) => el.classList.remove('dragging'))
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
        localStorage.setItem(SIDEBAR_KEY, String(latest))
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    },
    [width],
  )

  return [width, setWidth, startDrag]
}

export default function App() {
  const [tab, setTab] = useState<Tab>('wallet')
  const [entry, setEntry] = useState<KeyEntry | null>(null)
  const [info, setInfo] = useState<CliInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [bootstrapping, setBootstrapping] = useState(true)
  const [, , startDrag] = useSidebarWidth()

  async function bootstrap() {
    setBootstrapping(true)
    try {
      const cliMeta = await cliInfo()
      setInfo(cliMeta)
      const e = await loadActiveKey()
      setEntry(e)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBootstrapping(false)
    }
  }

  useEffect(() => {
    void bootstrap()
  }, [])

  async function handleConnect() {
    setError(null)
    setBusy(true)
    try {
      await cliLogin()
      const e = await loadActiveKey()
      setEntry(e)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function handleDisconnect() {
    setBusy(true)
    try {
      await cliLogout()
    } catch {}
    setEntry(null)
    setBusy(false)
  }

  if (bootstrapping) {
    return (
      <div className="app">
        <div className="titlebar" data-tauri-drag-region>Tempo</div>
        <div className="content">
          <main className="main">
            <div className="empty" style={{ paddingTop: 80 }}>
              Loading…
            </div>
          </main>
        </div>
      </div>
    )
  }

  if (!entry) {
    return (
      <div className="app">
        <div className="titlebar" data-tauri-drag-region>
          Tempo<span className="net">· {network === 'testnet' ? 'Moderato Testnet' : 'Mainnet'}</span>
        </div>
        <div className="content">
          <main className="main">
            <Connect cli={info} busy={busy} onConnect={handleConnect} error={error} />
            <div style={{ marginTop: 32, textAlign: 'center' }}>
              <a
                href="#"
                style={{ color: 'var(--text-dim)', fontSize: 11 }}
                onClick={(e) => {
                  e.preventDefault()
                  setNetwork(network === 'mainnet' ? 'testnet' : 'mainnet')
                }}
              >
                Switch to {network === 'mainnet' ? 'testnet' : 'mainnet'}
              </a>
            </div>
          </main>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <div className="titlebar" data-tauri-drag-region>
        Tempo<span className="net">· {network === 'testnet' ? 'Moderato Testnet' : 'Mainnet'}</span>
      </div>
      <div className="content">
        <aside className="sidebar">
          <div className="sidebar-resize" onPointerDown={startDrag} />
          <button className={tab === 'wallet' ? 'active' : ''} onClick={() => setTab('wallet')}>
            Wallet
          </button>
          <button className={tab === 'send' ? 'active' : ''} onClick={() => setTab('send')}>
            Send
          </button>
          <button className={tab === 'services' ? 'active' : ''} onClick={() => setTab('services')}>
            Services
          </button>
          <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>
            History
          </button>
          <div className="footer">
            <div className="addr">{shortAddress(entry.walletAddress)}</div>
            <div style={{ marginTop: 6 }}>
              <button
                className="ghost"
                style={{ padding: '4px 8px', fontSize: 11 }}
                onClick={handleDisconnect}
                disabled={busy}
              >
                {busy ? 'Working…' : 'Sign out'}
              </button>
            </div>
            <div style={{ marginTop: 12, fontSize: 10 }}>
              <a
                href="#"
                style={{ color: 'var(--text-dim)' }}
                onClick={(e) => {
                  e.preventDefault()
                  setNetwork(network === 'mainnet' ? 'testnet' : 'mainnet')
                }}
              >
                Switch to {network === 'mainnet' ? 'testnet' : 'mainnet'}
              </a>
            </div>
            {error && <div className="error">{error}</div>}
          </div>
        </aside>
        <main className="main">
          {tab === 'wallet' && <Wallet account={entry.walletAddress} />}
          {tab === 'send' && <Send account={entry.walletAddress} />}
          {tab === 'services' && <Services account={entry.walletAddress} />}
          {tab === 'history' && <History account={entry.walletAddress} />}
        </main>
      </div>
    </div>
  )
}
