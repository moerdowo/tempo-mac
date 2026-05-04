import { useEffect, useState } from 'react'
import type { Address } from 'viem'
import { getBalances, txUrl } from '../lib/wallet'
import { getTransferHistory, type Transfer } from '../lib/history'
import { formatUnits, shortAddress } from '../lib/format'
import { openUrl } from '@tauri-apps/plugin-opener'

export function History({ account }: { account: Address }) {
  const [transfers, setTransfers] = useState<Transfer[] | null>(null)
  const [meta, setMeta] = useState<Record<string, { symbol: string; decimals: number }>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const balances = await getBalances(account)
      const tokenMeta: Record<string, { symbol: string; decimals: number }> = {}
      for (const b of balances) {
        tokenMeta[b.address.toLowerCase()] = { symbol: b.symbol, decimals: b.decimals }
      }
      setMeta(tokenMeta)
      const txs = await getTransferHistory(
        account,
        balances.map((b) => b.address),
      )
      setTransfers(txs)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account])

  return (
    <div>
      <div className="row between">
        <h1>History</h1>
        <button className="ghost" onClick={load} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>
      <p className="sub">Recent token transfers involving your account.</p>

      <div className="card">
        {transfers === null && loading && <div className="empty">Loading history…</div>}
        {transfers !== null && transfers.length === 0 && (
          <div className="empty">No recent transfers.</div>
        )}
        {transfers?.map((t) => {
          const m = meta[t.token.toLowerCase()]
          const decimals = m?.decimals ?? 6
          const symbol = m?.symbol ?? '???'
          const sign = t.direction === 'out' ? '−' : t.direction === 'in' ? '+' : ''
          const counterparty = t.direction === 'out' ? t.to : t.from
          return (
            <div className="tx-row" key={`${t.hash}-${t.direction}`}>
              <span className="arrow">{t.direction === 'out' ? '↗' : '↘'}</span>
              <div>
                <div>
                  {sign}
                  {formatUnits(t.value, decimals)} {symbol}
                </div>
                <div className="addr" style={{ fontSize: 11 }}>
                  {t.direction === 'out' ? 'to' : 'from'} {shortAddress(counterparty)} · block {String(t.blockNumber)}
                </div>
              </div>
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault()
                  void openUrl(txUrl(t.hash))
                }}
              >
                view ↗
              </a>
            </div>
          )
        })}
        {error && <div className="error">{error}</div>}
      </div>
    </div>
  )
}
