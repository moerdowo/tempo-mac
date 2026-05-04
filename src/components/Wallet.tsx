import { useEffect, useState } from 'react'
import type { Address } from 'viem'
import { type Balance, getBalances, addressUrl } from '../lib/wallet'
import { formatUnits, shortAddress } from '../lib/format'
import { openUrl } from '@tauri-apps/plugin-opener'

export function Wallet({ account }: { account: Address }) {
  const [balances, setBalances] = useState<Balance[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function refresh() {
    setLoading(true)
    setError(null)
    try {
      const b = await getBalances(account)
      b.sort((x, y) => Number(y.balance - x.balance))
      setBalances(b)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account])

  return (
    <div>
      <div className="row between">
        <div>
          <h1>Wallet</h1>
          <a
            href="#"
            className="addr"
            onClick={(e) => {
              e.preventDefault()
              void openUrl(addressUrl(account))
            }}
          >
            {shortAddress(account)} ↗
          </a>
        </div>
        <button className="ghost" onClick={refresh} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <h2>Balances</h2>
      <div className="card">
        {balances === null && loading && <div className="empty">Loading balances…</div>}
        {balances !== null && balances.length === 0 && (
          <div className="empty">
            No tokens yet. Fund your wallet with <code>tempo wallet fund</code>.
          </div>
        )}
        {balances?.map((b) => (
          <div className="balance-row" key={b.address}>
            <div>
              <div className="symbol">{b.symbol}</div>
              <div className="name">{b.name}</div>
            </div>
            <div className="amount">{formatUnits(b.balance, b.decimals)}</div>
          </div>
        ))}
        {error && <div className="error">{error}</div>}
      </div>
    </div>
  )
}
