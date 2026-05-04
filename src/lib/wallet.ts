import { tempo, tempoModerato } from 'viem/chains'
import { createPublicClient, http, parseAbi, type Address } from 'viem'
import { invoke } from '@tauri-apps/api/core'

export type Network = 'mainnet' | 'testnet'

const STORAGE_KEY = 'tempo-mac:network'

export function getNetwork(): Network {
  const v = localStorage.getItem(STORAGE_KEY)
  return v === 'testnet' ? 'testnet' : 'mainnet'
}

export function setNetwork(network: Network) {
  localStorage.setItem(STORAGE_KEY, network)
  window.location.reload()
}

export const network = getNetwork()
export const isTestnet = network === 'testnet'
export const chain = isTestnet ? tempoModerato : tempo

export const publicClient = createPublicClient({
  chain,
  transport: http(),
})

export type KeyEntry = {
  walletAddress: Address
  walletType: string
  chainId: number
  keyType: 'secp256k1' | 'p256'
  keyAddress: Address
  key: `0x${string}`
  keyAuthorization: `0x${string}`
  expiry: number
  limits: { token: Address; limit: string }[]
}

export type CliInfo = {
  installed: boolean
  path: string | null
  version: string | null
}

export type CliResult = {
  success: boolean
  stdout: string
  stderr: string
  code: number | null
}

export async function cliInfo(): Promise<CliInfo> {
  return invoke('cli_info')
}

export async function cliLogin(): Promise<CliResult> {
  return invoke('cli_login', { testnet: isTestnet })
}

export async function cliLogout(): Promise<CliResult> {
  return invoke('cli_logout')
}

export async function cliWhoami(): Promise<CliResult> {
  return invoke('cli_whoami', { testnet: isTestnet })
}

export async function cliTransfer(
  amount: string,
  token: string,
  to: string,
): Promise<CliResult> {
  return invoke('cli_transfer', { amount, token, to, testnet: isTestnet })
}

export async function cliRequest(
  url: string,
  options: { method?: string; body?: string; dryRun?: boolean } = {},
): Promise<CliResult> {
  return invoke('cli_request', {
    url,
    method: options.method,
    body: options.body,
    dryRun: options.dryRun ?? false,
    testnet: isTestnet,
  })
}

export async function loadActiveKey(): Promise<KeyEntry | null> {
  const entry = await invoke<KeyEntry | null>('keyring_active', {
    chainId: chain.id,
  })
  return entry
}

export async function disconnectChain(): Promise<void> {
  await invoke('keyring_remove_chain', { chainId: chain.id })
}

export function explorerBase(): string {
  return isTestnet ? 'https://explore.testnet.tempo.xyz' : 'https://explore.tempo.xyz'
}

export function txUrl(hash: string): string {
  return `${explorerBase()}/tx/${hash}`
}

export function addressUrl(address: string): string {
  return `${explorerBase()}/address/${address}`
}

export type TokenMeta = {
  address: Address
  name: string
  symbol: string
  decimals: number
  logoURI?: string
}

export type Balance = TokenMeta & {
  balance: bigint
}

const erc20BalanceOf = parseAbi(['function balanceOf(address) view returns (uint256)'])

let tokenCache: { chainId: number; tokens: TokenMeta[] } | null = null

export async function fetchTokens(): Promise<TokenMeta[]> {
  if (tokenCache && tokenCache.chainId === chain.id) return tokenCache.tokens
  const list = await invoke<{ tokens: TokenMeta[] }>('fetch_tokens', {
    chainId: chain.id,
  })
  tokenCache = { chainId: chain.id, tokens: list.tokens }
  return list.tokens
}

export async function getBalances(account: Address): Promise<Balance[]> {
  const tokens = await fetchTokens()
  if (tokens.length === 0) return []
  const balances = await Promise.all(
    tokens.map((t) =>
      publicClient
        .readContract({
          address: t.address,
          abi: erc20BalanceOf,
          functionName: 'balanceOf',
          args: [account],
        })
        .then((b) => b as bigint)
        .catch(() => 0n),
    ),
  )
  return tokens.map((t, i) => ({ ...t, balance: balances[i] }))
}
