import { useEffect, useState } from 'react'
import { isAddress, type Address } from 'viem'
import { cliTransfer, getBalances, type Balance } from '../lib/wallet'
import { formatUnits } from '../lib/format'

export function Send({ account }: { account: Address }) {
  const [balances, setBalances] = useState<Balance[]>([])
  const [tokenSymbol, setTokenSymbol] = useState('')
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [output, setOutput] = useState<string | null>(null)

  useEffect(() => {
    getBalances(account)
      .then((b) => {
        setBalances(b)
        if (b.length > 0) setTokenSymbol(b[0].symbol)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [account])

  const selected = balances.find((b) => b.symbol === tokenSymbol)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setOutput(null)
    if (!selected) return setError('select a token')
    if (!isAddress(to)) return setError('invalid recipient address')
    if (!amount.trim() || !/^\d+(\.\d+)?$/.test(amount.trim())) {
      return setError('invalid amount')
    }

    setSubmitting(true)
    try {
      const r = await cliTransfer(amount.trim(), selected.symbol, to)
      setOutput(r.stdout || r.stderr)
      if (!r.success) {
        setError(r.stderr.trim() || `transfer exited with code ${r.code}`)
      } else {
        setAmount('')
        setTo('')
        const fresh = await getBalances(account)
        setBalances(fresh)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <h1>Send</h1>
      <p className="sub">
        Transfer stablecoins via <code>tempo wallet transfer</code> using your
        delegated access key.
      </p>
      <form onSubmit={submit} className="card">
        <label>Token</label>
        <select value={tokenSymbol} onChange={(e) => setTokenSymbol(e.target.value)}>
          {balances.map((b) => (
            <option key={b.address} value={b.symbol}>
              {b.symbol} — {formatUnits(b.balance, b.decimals)}
            </option>
          ))}
          {balances.length === 0 && <option value="">No balances</option>}
        </select>

        <label>Recipient</label>
        <input
          placeholder="0x…"
          value={to}
          onChange={(e) => setTo(e.target.value.trim())}
          spellCheck={false}
        />

        <label>Amount</label>
        <input
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
        />

        <div style={{ marginTop: 18 }}>
          <button className="primary" type="submit" disabled={submitting || !selected}>
            {submitting ? 'Sending…' : 'Send'}
          </button>
        </div>

        {error && <div className="error">{error}</div>}
        {output && (
          <>
            <h2 style={{ marginTop: 18 }}>CLI output</h2>
            <pre className="code">{output}</pre>
          </>
        )}
      </form>
    </div>
  )
}
