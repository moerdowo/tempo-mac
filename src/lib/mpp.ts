import { invoke } from '@tauri-apps/api/core'
import { cliRequest } from './wallet'

export type ProbeResult = {
  status: number
  headers: Record<string, string>
  body?: string
  www_authenticate?: string
  accept_payment?: string
}

export async function probePayment(
  url: string,
  init?: { method?: string; body?: string; headers?: Record<string, string> },
): Promise<ProbeResult> {
  return invoke<ProbeResult>('probe_payment', {
    req: {
      url,
      method: init?.method,
      body: init?.body,
      headers: init?.headers,
    },
  })
}

export async function paidRequest(
  url: string,
  options: { method?: string; body?: string } = {},
): Promise<{ success: boolean; stdout: string; stderr: string }> {
  const r = await cliRequest(url, options)
  return { success: r.success, stdout: r.stdout, stderr: r.stderr }
}

export async function dryRun(
  url: string,
  options: { method?: string; body?: string } = {},
): Promise<{ success: boolean; stdout: string; stderr: string }> {
  const r = await cliRequest(url, { ...options, dryRun: true })
  return { success: r.success, stdout: r.stdout, stderr: r.stderr }
}

export async function fetchOpenApi(url: string): Promise<unknown> {
  return invoke('fetch_openapi', { url })
}

export type DiscoveredOperation = {
  path: string
  method: string
  summary?: string
  amount?: string
  currency?: string
  description?: string
  intent?: string
  paymentMethod?: string
}

export type DiscoveredService = {
  title: string
  version: string
  baseUrl?: string
  categories?: string[]
  homepage?: string
  apiReference?: string
  operations: DiscoveredOperation[]
}

export async function discover(serviceUrl: string): Promise<DiscoveredService> {
  let openapiUrl: string
  try {
    const u = new URL(serviceUrl)
    if (u.pathname === '/' || !u.pathname.endsWith('.json')) {
      u.pathname = u.pathname.replace(/\/$/, '') + '/openapi.json'
    }
    openapiUrl = u.toString()
  } catch {
    throw new Error('invalid URL')
  }

  let doc: any
  try {
    doc = await fetchOpenApi(openapiUrl)
  } catch {
    const u = new URL(serviceUrl)
    u.pathname = '/.well-known/openapi.json'
    doc = await fetchOpenApi(u.toString())
  }

  const operations: DiscoveredOperation[] = []
  const paths = doc.paths ?? {}
  for (const [path, item] of Object.entries<any>(paths)) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      const op = item?.[method]
      if (!op) continue
      const pi = op['x-payment-info']
      const offer = pi?.offers?.[0] ?? pi
      operations.push({
        path,
        method: method.toUpperCase(),
        summary: op.summary,
        amount: offer?.amount,
        currency: offer?.currency,
        description: offer?.description,
        intent: offer?.intent,
        paymentMethod: offer?.method,
      })
    }
  }

  const baseUrl = doc.servers?.[0]?.url
  const info = doc['x-service-info'] ?? {}
  return {
    title: doc.info?.title ?? 'Service',
    version: doc.info?.version ?? '',
    baseUrl,
    categories: info.categories,
    homepage: info.docs?.homepage,
    apiReference: info.docs?.apiReference,
    operations,
  }
}
