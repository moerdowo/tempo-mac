import { fetchOpenApi } from './mpp'
import type { Service, ServiceEndpoint } from './services'
import { buildEndpointUrl } from './services'

export type StringFormat =
  | 'email'
  | 'uri'
  | 'url'
  | 'date'
  | 'date-time'
  | 'uuid'
  | 'password'
  | 'binary'
  | 'byte'
  | 'hostname'
  | 'ipv4'
  | 'ipv6'
  | 'plain'

export type Field =
  | {
      kind: 'string'
      path: string
      label: string
      description?: string
      required: boolean
      format?: StringFormat
      pattern?: string
      enumValues?: string[]
      placeholder?: string
      multiline?: boolean
      defaultValue?: string
    }
  | {
      kind: 'number'
      path: string
      label: string
      description?: string
      required: boolean
      integer: boolean
      min?: number
      max?: number
      defaultValue?: number
    }
  | {
      kind: 'boolean'
      path: string
      label: string
      description?: string
      required: boolean
      defaultValue?: boolean
    }
  | {
      kind: 'enum'
      path: string
      label: string
      description?: string
      required: boolean
      values: Array<string | number | boolean>
      defaultValue?: string | number | boolean
    }
  | {
      kind: 'object'
      path: string
      label: string
      description?: string
      required: boolean
      fields: Field[]
    }
  | {
      kind: 'array'
      path: string
      label: string
      description?: string
      required: boolean
      itemField: Field
    }
  | {
      kind: 'json'
      path: string
      label: string
      description?: string
      required: boolean
      defaultValue?: string
    }

const openApiCache = new Map<string, any | null>()
const inflight = new Map<string, Promise<any | null>>()

export async function loadOpenApi(service: Service): Promise<any | null> {
  const base = (service.serviceUrl ?? service.url).replace(/\/$/, '')
  const candidates = [
    service.docs?.openapi,
    `${base}/openapi.json`,
    `${base}/.well-known/openapi.json`,
    `${base}/openapi`,
  ].filter((u): u is string => Boolean(u))

  for (const url of candidates) {
    if (openApiCache.has(url)) {
      const cached = openApiCache.get(url)
      if (cached) return cached
      continue
    }
    if (inflight.has(url)) {
      const result = await inflight.get(url)!
      if (result) return result
      continue
    }
    const promise = fetchOpenApi(url)
      .then((doc) => {
        openApiCache.set(url, doc)
        return doc as any
      })
      .catch(() => {
        openApiCache.set(url, null)
        return null
      })
      .finally(() => inflight.delete(url))
    inflight.set(url, promise)
    const result = await promise
    if (result) return result
  }
  return null
}

export function findOperation(doc: any, method: string, path: string): any | null {
  const paths = doc?.paths ?? {}
  const m = method.toLowerCase()
  if (paths[path]?.[m]) return paths[path][m]
  // Try {name} style
  const braced = path.replace(/:([a-zA-Z0-9_]+)/g, '{$1}')
  if (paths[braced]?.[m]) return paths[braced][m]
  // Try :name style
  const colon = path.replace(/\{([a-zA-Z0-9_]+)\}/g, ':$1')
  if (paths[colon]?.[m]) return paths[colon][m]
  // Linear scan: compare normalized path templates (parameter names ignored)
  const norm = (s: string) =>
    s.replace(/\{[a-zA-Z0-9_]+\}/g, '{}').replace(/:[a-zA-Z0-9_]+/g, '{}')
  const target = norm(path)
  for (const [p, ops] of Object.entries<any>(paths)) {
    if (norm(p) === target && ops?.[m]) return ops[m]
  }
  return null
}

function resolveRef(doc: any, ref: string): any {
  if (!ref?.startsWith('#/')) return null
  const parts = ref.slice(2).split('/').map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'))
  let cur: any = doc
  for (const part of parts) {
    cur = cur?.[part]
    if (cur === undefined) return null
  }
  return cur
}

function dereference(doc: any, schema: any, seen: Set<string> = new Set()): any {
  if (!schema || typeof schema !== 'object') return schema
  if (schema.$ref) {
    if (seen.has(schema.$ref)) return { type: 'object' }
    const next = new Set(seen).add(schema.$ref)
    return dereference(doc, resolveRef(doc, schema.$ref), next)
  }
  // allOf: merge all members
  if (Array.isArray(schema.allOf)) {
    const merged: any = { type: 'object', properties: {}, required: [] }
    for (const part of schema.allOf) {
      const resolved = dereference(doc, part, seen)
      if (!resolved) continue
      Object.assign(merged.properties, resolved.properties ?? {})
      if (resolved.required) merged.required.push(...resolved.required)
      if (resolved.type) merged.type = resolved.type
      if (resolved.additionalProperties !== undefined) {
        merged.additionalProperties = resolved.additionalProperties
      }
    }
    if (schema.properties) Object.assign(merged.properties, schema.properties)
    if (schema.required) merged.required.push(...schema.required)
    if (schema.description) merged.description = schema.description
    if (schema.example !== undefined) merged.example = schema.example
    return merged
  }
  // oneOf / anyOf: use the first variant for the form
  const variant = schema.oneOf?.[0] ?? schema.anyOf?.[0]
  if (variant) {
    const resolved = dereference(doc, variant, seen)
    return { ...resolved, ...{ description: schema.description ?? resolved?.description } }
  }
  return schema
}

function inferPlaceholder(schema: any): string | undefined {
  if (schema.example !== undefined && typeof schema.example !== 'object') {
    return String(schema.example)
  }
  if (schema.default !== undefined && typeof schema.default !== 'object') {
    return String(schema.default)
  }
  if (typeof schema.description === 'string') {
    const match = schema.description.match(/e\.g\.?\s+["']?([^"',.]+)["']?/i)
    if (match) return match[1].trim()
  }
  return undefined
}

function looksLikeMultiline(name: string, schema: any): boolean {
  if (schema.format === 'binary' || schema.format === 'byte') return true
  if (typeof schema.maxLength === 'number' && schema.maxLength > 200) return true
  const lower = name.toLowerCase()
  return ['body', 'content', 'text', 'message', 'prompt', 'html', 'markdown', 'description'].some(
    (k) => lower.includes(k),
  )
}

function fieldFromSchema(
  doc: any,
  rawSchema: any,
  parentPath: string,
  name: string,
  required: boolean,
  depth = 0,
): Field {
  const path = parentPath ? `${parentPath}.${name}` : name
  const schema = dereference(doc, rawSchema) ?? {}
  const label = name
  const description = typeof schema.description === 'string' ? schema.description : undefined

  if (depth > 5) {
    return {
      kind: 'json',
      path,
      label,
      description,
      required,
      defaultValue: '{}',
    }
  }

  // Enum
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return {
      kind: 'enum',
      path,
      label,
      description,
      required,
      values: schema.enum,
      defaultValue: schema.default ?? schema.enum[0],
    }
  }

  // oneOf/anyOf with const values → enum-like
  const variants = schema.oneOf ?? schema.anyOf
  if (Array.isArray(variants) && variants.every((v: any) => 'const' in (v ?? {}))) {
    return {
      kind: 'enum',
      path,
      label,
      description,
      required,
      values: variants.map((v: any) => v.const),
      defaultValue: schema.default ?? variants[0].const,
    }
  }

  const type = Array.isArray(schema.type) ? schema.type.find((t: string) => t !== 'null') : schema.type

  if (type === 'string' || schema.format === 'binary') {
    const format = schema.format as StringFormat | undefined
    return {
      kind: 'string',
      path,
      label,
      description,
      required,
      format,
      pattern: schema.pattern,
      enumValues: schema.enum,
      placeholder: inferPlaceholder(schema),
      multiline: looksLikeMultiline(name, schema),
      defaultValue: typeof schema.default === 'string' ? schema.default : undefined,
    }
  }

  if (type === 'integer' || type === 'number') {
    return {
      kind: 'number',
      path,
      label,
      description,
      required,
      integer: type === 'integer',
      min: typeof schema.minimum === 'number' ? schema.minimum : undefined,
      max: typeof schema.maximum === 'number' ? schema.maximum : undefined,
      defaultValue: typeof schema.default === 'number' ? schema.default : undefined,
    }
  }

  if (type === 'boolean') {
    return {
      kind: 'boolean',
      path,
      label,
      description,
      required,
      defaultValue: typeof schema.default === 'boolean' ? schema.default : undefined,
    }
  }

  if (type === 'array') {
    const itemField = fieldFromSchema(doc, schema.items ?? {}, path, '0', false, depth + 1)
    return { kind: 'array', path, label, description, required, itemField }
  }

  if (type === 'object' || schema.properties) {
    const props = schema.properties ?? {}
    const requiredList: string[] = Array.isArray(schema.required) ? schema.required : []
    const fields: Field[] = []
    for (const [k, v] of Object.entries<any>(props)) {
      fields.push(fieldFromSchema(doc, v, path, k, requiredList.includes(k), depth + 1))
    }
    if (fields.length === 0) {
      return {
        kind: 'json',
        path,
        label,
        description,
        required,
        defaultValue: '{}',
      }
    }
    return { kind: 'object', path, label, description, required, fields }
  }

  // Fallback: free-form JSON
  return {
    kind: 'json',
    path,
    label,
    description,
    required,
    defaultValue:
      schema.example !== undefined ? JSON.stringify(schema.example, null, 2) : '',
  }
}

export type RequestBodyShape = {
  topFields: Field[]
  required: string[]
  raw: any
}

export function getRequestBodySchema(doc: any, op: any): RequestBodyShape | null {
  const content = op?.requestBody?.content
  if (!content) return null
  const json = content['application/json'] ?? content['application/*+json']
  if (!json?.schema) return null
  const resolved = dereference(doc, json.schema)
  if (!resolved) return null
  if (resolved.type === 'object' || resolved.properties) {
    const props = resolved.properties ?? {}
    const requiredList: string[] = Array.isArray(resolved.required) ? resolved.required : []
    const topFields: Field[] = Object.entries<any>(props).map(([k, v]) =>
      fieldFromSchema(doc, v, '', k, requiredList.includes(k), 0),
    )
    return { topFields, required: requiredList, raw: resolved }
  }
  // Top-level array or scalar: wrap in a single 'value' field
  const single = fieldFromSchema(doc, resolved, '', 'value', true, 0)
  return { topFields: [single], required: ['value'], raw: resolved }
}

export function defaultValueFor(field: Field): unknown {
  switch (field.kind) {
    case 'string':
      return field.defaultValue ?? ''
    case 'number':
      return field.defaultValue ?? null
    case 'boolean':
      return field.defaultValue ?? false
    case 'enum':
      return field.defaultValue ?? field.values[0]
    case 'object': {
      const obj: Record<string, unknown> = {}
      for (const f of field.fields) {
        if (f.required) obj[lastSegment(f.path)] = defaultValueFor(f)
      }
      return obj
    }
    case 'array':
      return []
    case 'json':
      return field.defaultValue ?? ''
  }
}

export function lastSegment(path: string): string {
  const i = path.lastIndexOf('.')
  return i === -1 ? path : path.slice(i + 1)
}

export function buildInitialBody(shape: RequestBodyShape): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of shape.topFields) {
    if (f.required) {
      out[lastSegment(f.path)] = defaultValueFor(f)
    }
  }
  return out
}

export function pruneEmpty(value: unknown): unknown {
  if (value === null || value === undefined || value === '') return undefined
  if (Array.isArray(value)) {
    const arr = value.map(pruneEmpty).filter((v) => v !== undefined)
    return arr.length === 0 ? undefined : arr
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      const pruned = pruneEmpty(v)
      if (pruned !== undefined) out[k] = pruned
    }
    return Object.keys(out).length === 0 ? undefined : out
  }
  return value
}

function exampleForParam(doc: any, parameter: any): string | null {
  if (parameter?.example !== undefined) return String(parameter.example)
  if (parameter?.schema?.example !== undefined) return String(parameter.schema.example)
  if (parameter?.schema?.default !== undefined) return String(parameter.schema.default)
  if (parameter?.schema?.$ref) {
    const resolved = resolveRef(doc, parameter.schema.$ref)
    if (resolved?.example !== undefined) return String(resolved.example)
    if (resolved?.default !== undefined) return String(resolved.default)
  }
  return null
}

export function fillPathParams(
  url: string,
  doc: any,
  op: any,
): { url: string; missing: string[] } {
  const params: any[] = op?.parameters ?? []
  const missing: string[] = []
  const replaced = url.replace(/\{([a-zA-Z0-9_]+)\}|:([a-zA-Z0-9_]+)/g, (_m, a, b) => {
    const name = a ?? b
    const param = params.find(
      (p: any) => p?.name === name && (p?.in === 'path' || p?.in === undefined),
    )
    const example = exampleForParam(doc, param)
    if (example) return encodeURIComponent(example)
    missing.push(name)
    return `<${name}>`
  })
  return { url: replaced, missing }
}

export type Prepared = {
  url: string
  pathMissing: string[]
  shape: RequestBodyShape | null
  initialBody: Record<string, unknown> | null
}

export async function prepareEndpoint(
  service: Service,
  endpoint: ServiceEndpoint,
): Promise<Prepared> {
  const baseUrl = buildEndpointUrl(service, endpoint)
  const doc = await loadOpenApi(service)
  if (!doc) {
    return { url: stripBare(baseUrl).url, pathMissing: stripBare(baseUrl).missing, shape: null, initialBody: null }
  }
  const op = findOperation(doc, endpoint.method, endpoint.path)
  if (!op) {
    return { url: stripBare(baseUrl).url, pathMissing: stripBare(baseUrl).missing, shape: null, initialBody: null }
  }
  const filled = fillPathParams(baseUrl, doc, op)
  const shape = ['POST', 'PUT', 'PATCH'].includes(endpoint.method)
    ? getRequestBodySchema(doc, op)
    : null
  return {
    url: filled.url,
    pathMissing: filled.missing,
    shape,
    initialBody: shape ? buildInitialBody(shape) : null,
  }
}

function stripBare(url: string): { url: string; missing: string[] } {
  const missing: string[] = []
  const replaced = url.replace(/\{([a-zA-Z0-9_]+)\}|:([a-zA-Z0-9_]+)/g, (_m, a, b) => {
    const name = a ?? b
    missing.push(name)
    return `<${name}>`
  })
  return { url: replaced, missing }
}
