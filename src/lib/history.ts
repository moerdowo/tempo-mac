import { parseAbiItem, type Address } from 'viem'
import { publicClient } from './wallet'

const transferEvent = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 value)',
)

export type Transfer = {
  hash: `0x${string}`
  blockNumber: bigint
  token: Address
  from: Address
  to: Address
  value: bigint
  direction: 'in' | 'out' | 'self'
}

const CHUNK = 99_000n
const MAX_CHUNKS = 6
const TARGET_RESULTS = 50

export async function getTransferHistory(account: Address, tokens: Address[]): Promise<Transfer[]> {
  if (tokens.length === 0) return []
  const latest = await publicClient.getBlockNumber()

  const seen = new Set<string>()
  const out: Transfer[] = []
  const lower = account.toLowerCase()

  let toBlock = latest
  for (let i = 0; i < MAX_CHUNKS && toBlock > 0n && out.length < TARGET_RESULTS; i++) {
    const fromBlock = toBlock > CHUNK ? toBlock - CHUNK : 0n
    const [outgoing, incoming] = await Promise.all([
      publicClient.getLogs({
        address: tokens,
        event: transferEvent,
        args: { from: account },
        fromBlock,
        toBlock,
      }),
      publicClient.getLogs({
        address: tokens,
        event: transferEvent,
        args: { to: account },
        fromBlock,
        toBlock,
      }),
    ])

    for (const log of [...outgoing, ...incoming]) {
      const key = `${log.transactionHash}-${log.logIndex}`
      if (seen.has(key)) continue
      seen.add(key)
      const from = log.args.from as Address
      const to = log.args.to as Address
      let direction: Transfer['direction'] = 'self'
      if (from.toLowerCase() === lower && to.toLowerCase() === lower) direction = 'self'
      else if (from.toLowerCase() === lower) direction = 'out'
      else direction = 'in'
      out.push({
        hash: log.transactionHash!,
        blockNumber: log.blockNumber!,
        token: log.address,
        from,
        to,
        value: log.args.value!,
        direction,
      })
    }

    if (fromBlock === 0n) break
    toBlock = fromBlock - 1n
  }

  return out
    .sort((a, b) => Number(b.blockNumber - a.blockNumber))
    .slice(0, TARGET_RESULTS)
}
