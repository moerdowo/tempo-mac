export function shortAddress(addr: string): string {
  if (!addr) return ''
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

export function formatUnits(value: bigint, decimals: number): string {
  const negative = value < 0n
  const abs = negative ? -value : value
  const base = 10n ** BigInt(decimals)
  const whole = abs / base
  const frac = abs % base
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '')
  const result = fracStr.length > 0 ? `${whole}.${fracStr.slice(0, 6)}` : whole.toString()
  return negative ? `-${result}` : result
}

export function parseUnits(value: string, decimals: number): bigint {
  const [whole, frac = ''] = value.trim().split('.')
  if (!/^\d+$/.test(whole) || (frac && !/^\d+$/.test(frac))) {
    throw new Error('invalid number')
  }
  const padded = (frac + '0'.repeat(decimals)).slice(0, decimals)
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded || '0')
}
