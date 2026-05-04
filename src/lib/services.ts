import { invoke } from '@tauri-apps/api/core'

export type ServicePayment = {
  intent?: string
  method?: string
  currency?: string
  decimals?: number
  description?: string
  amount?: string
}

export type ServiceEndpoint = {
  method: string
  path: string
  description?: string
  payment?: ServicePayment | null
  docs?: string
}

export type ServiceMethod = {
  intents?: string[]
  assets?: string[]
}

export type ServiceProvider = {
  name?: string
  url?: string
}

export type ServiceDocs = {
  homepage?: string
  llmsTxt?: string
  openapi?: string
  apiReference?: string
}

export type Service = {
  id: string
  name: string
  url: string
  serviceUrl?: string
  description?: string
  icon?: string
  categories?: string[]
  integration?: string
  tags?: string[]
  status?: string
  docs?: ServiceDocs
  methods?: Record<string, ServiceMethod>
  realm?: string
  endpoints?: ServiceEndpoint[]
  provider?: ServiceProvider
}

export async function fetchServices(): Promise<Service[]> {
  const data = await invoke<{ services: Service[] }>('fetch_services')
  return data.services ?? []
}

export function buildEndpointUrl(service: Service, endpoint: ServiceEndpoint): string {
  const base = (service.serviceUrl ?? service.url).replace(/\/$/, '')
  const path = endpoint.path.startsWith('/') ? endpoint.path : `/${endpoint.path}`
  return `${base}${path}`
}

export function formatPrice(payment?: ServicePayment | null): string | null {
  if (!payment) return null
  if (!payment.amount) return null
  const decimals = payment.decimals ?? 6
  const amount = BigInt(payment.amount)
  if (amount === 0n) return 'free / proof-only'
  const base = 10n ** BigInt(decimals)
  const whole = amount / base
  const frac = amount % base
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '')
  const num = fracStr.length > 0 ? `${whole}.${fracStr.slice(0, 6)}` : whole.toString()
  return `${num} ${payment.method === 'tempo' ? '$' : ''}`
}
