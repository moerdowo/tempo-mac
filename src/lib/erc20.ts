import { encodeFunctionData, parseAbi, type Address } from 'viem'

export const erc20Abi = parseAbi([
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
])

export function encodeTransfer(to: Address, amount: bigint): `0x${string}` {
  return encodeFunctionData({
    abi: erc20Abi,
    functionName: 'transfer',
    args: [to, amount],
  })
}
