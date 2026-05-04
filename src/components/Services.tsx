import { useEffect, useMemo, useState } from 'react'
import type { Address } from 'viem'
import { dryRun, paidRequest, probePayment } from '../lib/mpp'
import {
  buildEndpointUrl,
  fetchServices,
  formatPrice,
  type Service,
  type ServiceEndpoint,
} from '../lib/services'
import { prepareEndpoint, pruneEmpty, type RequestBodyShape } from '../lib/forms'
import { RequestBodyForm } from './RequestBodyForm'
import { openUrl } from '@tauri-apps/plugin-opener'

type Tab = 'directory' | 'request'

export function Services({ account: _account }: { account: Address | null }) {
  const [tab, setTab] = useState<Tab>('directory')
  const [services, setServices] = useState<Service[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedService, setSelectedService] = useState<Service | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Request form state
  const [url, setUrl] = useState('https://mpp.dev/api/ping/paid')
  const [method, setMethod] = useState('GET')
  const [body, setBody] = useState('')
  const [bodyMode, setBodyMode] = useState<'form' | 'json'>('json')
  const [bodyShape, setBodyShape] = useState<RequestBodyShape | null>(null)
  const [formValue, setFormValue] = useState<unknown>({})
  const [preparing, setPreparing] = useState(false)
  const [running, setRunning] = useState(false)
  const [cliOutput, setCliOutput] = useState<string | null>(null)
  const [probe, setProbe] = useState<{
    status: number
    challenge?: string
    accept?: string
  } | null>(null)
  const [activeEndpoint, setActiveEndpoint] = useState<{
    service: string
    endpoint: ServiceEndpoint
    notes: string[]
  } | null>(null)

  async function loadServices() {
    setLoading(true)
    setError(null)
    try {
      const list = await fetchServices()
      setServices(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadServices()
  }, [])

  const filtered = useMemo(() => {
    if (!services) return []
    const q = search.trim().toLowerCase()
    if (!q) return services
    return services.filter((s) => {
      const haystack = [
        s.name,
        s.id,
        s.description ?? '',
        ...(s.categories ?? []),
        ...(s.tags ?? []),
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
  }, [services, search])

  async function useEndpoint(service: Service, endpoint: ServiceEndpoint) {
    setUrl(buildEndpointUrl(service, endpoint))
    setMethod(endpoint.method)
    setActiveEndpoint({ service: service.name, endpoint, notes: [] })
    setProbe(null)
    setCliOutput(null)
    setBody('')
    setBodyShape(null)
    setFormValue({})
    setBodyMode('json')
    setTab('request')
    setPreparing(true)
    try {
      const prepared = await prepareEndpoint(service, endpoint)
      setUrl(prepared.url)
      const notes: string[] = []
      if (prepared.pathMissing.length) {
        notes.push(
          `Replace ${prepared.pathMissing.map((m) => `<${m}>`).join(', ')} in URL`,
        )
      }
      if (prepared.shape) {
        setBodyShape(prepared.shape)
        setFormValue(prepared.initialBody ?? {})
        setBodyMode('form')
        setBody(JSON.stringify(prepared.initialBody ?? {}, null, 2))
      } else if (['POST', 'PUT', 'PATCH'].includes(endpoint.method)) {
        setBody('{}')
      }
      setActiveEndpoint({ service: service.name, endpoint, notes })
    } catch {
      // ignore — keep raw URL + empty body
    } finally {
      setPreparing(false)
    }
  }

  function syncFormToJson(next: unknown) {
    setFormValue(next)
    const cleaned = pruneEmpty(next) ?? {}
    setBody(JSON.stringify(cleaned, null, 2))
  }

  function syncJsonToForm(text: string): boolean {
    try {
      const parsed = text.trim() === '' ? {} : JSON.parse(text)
      setFormValue(parsed ?? {})
      return true
    } catch {
      return false
    }
  }

  async function runProbe() {
    setError(null)
    setProbe(null)
    setCliOutput(null)
    setRunning(true)
    try {
      const r = await probePayment(url, { method, body: body.trim() || undefined })
      setProbe({
        status: r.status,
        challenge: r.www_authenticate,
        accept: r.accept_payment,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  async function runDryRun() {
    setError(null)
    setCliOutput(null)
    setRunning(true)
    try {
      const r = await dryRun(url, { method, body: body.trim() || undefined })
      setCliOutput(r.stdout || r.stderr)
      if (!r.success) setError(r.stderr.trim() || 'dry-run failed')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  async function runPaid() {
    setError(null)
    setCliOutput(null)
    setRunning(true)
    try {
      const r = await paidRequest(url, { method, body: body.trim() || undefined })
      setCliOutput(r.stdout || r.stderr)
      if (!r.success) setError(r.stderr.trim() || 'request failed')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div>
      <div className="row between">
        <h1>Services</h1>
        <div className="row" style={{ gap: 8 }}>
          <button
            className={tab === 'directory' ? 'primary' : 'ghost'}
            onClick={() => setTab('directory')}
          >
            Directory
          </button>
          <button
            className={tab === 'request' ? 'primary' : 'ghost'}
            onClick={() => setTab('request')}
          >
            Request
          </button>
        </div>
      </div>
      <p className="sub">
        Browse services from the MPP directory and pay-per-call directly through{' '}
        <code>tempo request</code>.
      </p>

      {tab === 'directory' && (
        <>
          {selectedService ? (
            <ServiceDetail
              service={selectedService}
              onBack={() => setSelectedService(null)}
              onUseEndpoint={(ep) => useEndpoint(selectedService, ep)}
            />
          ) : (
            <>
              <div className="card" style={{ padding: 12, marginBottom: 12 }}>
                <input
                  placeholder="Search services by name, category, or tag…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <div className="sub" style={{ fontSize: 11, marginTop: 8 }}>
                  {loading
                    ? 'Loading directory…'
                    : services
                      ? `${filtered.length} of ${services.length} services`
                      : ''}
                  {' · '}
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault()
                      void loadServices()
                    }}
                  >
                    refresh
                  </a>
                </div>
              </div>

              {error && <div className="error">{error}</div>}

              {filtered.length === 0 && !loading && (
                <div className="empty">No services match.</div>
              )}

              <div style={{ display: 'grid', gap: 8 }}>
                {filtered.map((s) => (
                  <ServiceCard
                    key={s.id}
                    service={s}
                    onOpen={() => setSelectedService(s)}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {tab === 'request' && (
        <div className="card">
          {activeEndpoint && (
            <div
              style={{
                marginBottom: 12,
                padding: 10,
                borderRadius: 8,
                background: 'rgba(124, 92, 255, 0.08)',
                border: '1px solid rgba(124, 92, 255, 0.2)',
              }}
            >
              <div className="row between">
                <div style={{ fontSize: 12 }}>
                  <span className="tag">{activeEndpoint.endpoint.method}</span>{' '}
                  <code>{activeEndpoint.endpoint.path}</code>{' '}
                  <span style={{ color: 'var(--text-dim)' }}>
                    · {activeEndpoint.service}
                  </span>
                </div>
                <button
                  className="ghost"
                  style={{ padding: '2px 8px', fontSize: 11 }}
                  onClick={() => setActiveEndpoint(null)}
                >
                  Clear
                </button>
              </div>
              {activeEndpoint.notes.length > 0 && (
                <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-dim)' }}>
                  {activeEndpoint.notes.join(' · ')}
                </div>
              )}
            </div>
          )}

          <label>Endpoint</label>
          <div className="row" style={{ gap: 8 }}>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              style={{ width: 100 }}
            >
              {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
          </div>

          {(method === 'POST' || method === 'PUT' || method === 'PATCH') && (
            <>
              <div
                className="row between"
                style={{ marginTop: 12, alignItems: 'baseline' }}
              >
                <label style={{ margin: 0 }}>Body</label>
                <div className="row" style={{ gap: 4 }}>
                  <button
                    type="button"
                    className={bodyMode === 'form' ? 'primary' : 'ghost'}
                    style={{ padding: '3px 10px', fontSize: 11 }}
                    onClick={() => {
                      if (bodyShape) {
                        // sync JSON → form on switch
                        syncJsonToForm(body)
                        setBodyMode('form')
                      }
                    }}
                    disabled={!bodyShape}
                    title={bodyShape ? '' : 'No schema available for this endpoint'}
                  >
                    Form
                  </button>
                  <button
                    type="button"
                    className={bodyMode === 'json' ? 'primary' : 'ghost'}
                    style={{ padding: '3px 10px', fontSize: 11 }}
                    onClick={() => {
                      const cleaned = pruneEmpty(formValue) ?? {}
                      setBody(JSON.stringify(cleaned, null, 2))
                      setBodyMode('json')
                    }}
                  >
                    JSON
                  </button>
                </div>
              </div>
              {preparing && (
                <div className="sub" style={{ fontSize: 11, marginTop: 6 }}>
                  Loading schema…
                </div>
              )}
              {bodyMode === 'form' && bodyShape ? (
                <div style={{ marginTop: 8 }}>
                  <RequestBodyForm
                    fields={bodyShape.topFields}
                    value={formValue}
                    onChange={syncFormToJson}
                  />
                </div>
              ) : (
                <textarea
                  style={{ marginTop: 8 }}
                  value={body}
                  onChange={(e) => {
                    setBody(e.target.value)
                    if (bodyShape) syncJsonToForm(e.target.value)
                  }}
                  rows={6}
                  placeholder='{"input": "hello"}'
                  spellCheck={false}
                />
              )}
            </>
          )}

          <div className="row" style={{ gap: 8, marginTop: 18, flexWrap: 'wrap' }}>
            <button className="ghost" onClick={runProbe} disabled={running}>
              Probe (no payment)
            </button>
            <button className="ghost" onClick={runDryRun} disabled={running}>
              Dry-run (CLI)
            </button>
            <button className="primary" onClick={runPaid} disabled={running}>
              {running ? 'Working…' : 'Send & pay'}
            </button>
          </div>

          {error && <div className="error">{error}</div>}

          {probe && (
            <>
              <h2 style={{ marginTop: 24 }}>Probe</h2>
              <div className="card" style={{ background: 'rgba(0,0,0,0.25)' }}>
                <div>
                  Status: <span className="tag">{probe.status}</span>{' '}
                  {probe.status === 402 ? 'Payment required' : ''}
                </div>
                {probe.challenge && (
                  <>
                    <label>WWW-Authenticate</label>
                    <pre className="code">{probe.challenge}</pre>
                  </>
                )}
                {probe.accept && (
                  <>
                    <label>Accept-Payment</label>
                    <pre className="code">{probe.accept}</pre>
                  </>
                )}
              </div>
            </>
          )}

          {cliOutput && (
            <>
              <h2 style={{ marginTop: 24 }}>Response</h2>
              <pre className="code" style={{ maxHeight: 360 }}>
                {cliOutput}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function ServiceCard({ service, onOpen }: { service: Service; onOpen: () => void }) {
  const paidCount = service.endpoints?.filter((e) => e.payment).length ?? 0
  const totalCount = service.endpoints?.length ?? 0
  return (
    <div className="card" style={{ padding: 14, cursor: 'pointer' }} onClick={onOpen}>
      <div className="row between">
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{service.name}</span>
            {service.status && service.status !== 'active' && (
              <span className="tag">{service.status}</span>
            )}
          </div>
          {service.description && (
            <div className="sub" style={{ fontSize: 12, marginBottom: 6 }}>
              {service.description}
            </div>
          )}
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {(service.categories ?? []).slice(0, 4).map((c) => (
              <span key={c} className="tag">
                {c}
              </span>
            ))}
          </div>
        </div>
        <div style={{ textAlign: 'right', fontSize: 11, color: 'var(--text-dim)' }}>
          {paidCount > 0 && <div>{paidCount} paid</div>}
          {totalCount > 0 && <div>{totalCount} endpoints</div>}
        </div>
      </div>
    </div>
  )
}

function ServiceDetail({
  service,
  onBack,
  onUseEndpoint,
}: {
  service: Service
  onBack: () => void
  onUseEndpoint: (e: ServiceEndpoint) => void
}) {
  return (
    <div>
      <div className="row" style={{ gap: 8, marginBottom: 12 }}>
        <button className="ghost" onClick={onBack}>
          ← Directory
        </button>
        {service.docs?.homepage && (
          <button
            className="ghost"
            onClick={() => void openUrl(service.docs!.homepage!)}
          >
            Homepage ↗
          </button>
        )}
        {service.docs?.apiReference && (
          <button
            className="ghost"
            onClick={() => void openUrl(service.docs!.apiReference!)}
          >
            API ↗
          </button>
        )}
      </div>

      <h1 style={{ marginBottom: 4 }}>{service.name}</h1>
      <div className="addr" style={{ marginBottom: 8 }}>
        {service.serviceUrl ?? service.url}
      </div>
      {service.description && <p className="sub">{service.description}</p>}

      <div className="row" style={{ gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {(service.categories ?? []).map((c) => (
          <span key={c} className="tag">
            {c}
          </span>
        ))}
        {(service.tags ?? []).slice(0, 6).map((t) => (
          <span
            key={t}
            className="tag"
            style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--text-dim)' }}
          >
            {t}
          </span>
        ))}
      </div>

      <h2>Endpoints</h2>
      {(service.endpoints ?? []).length === 0 && (
        <div className="empty">No endpoints listed.</div>
      )}
      <div style={{ display: 'grid', gap: 6 }}>
        {(service.endpoints ?? []).map((e, i) => (
          <div key={i} className="card" style={{ padding: 12 }}>
            <div className="row between">
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ marginBottom: 4 }}>
                  <span className="tag">{e.method}</span>{' '}
                  <code style={{ fontSize: 12 }}>{e.path}</code>
                </div>
                {e.description && (
                  <div className="sub" style={{ fontSize: 12 }}>
                    {e.description}
                  </div>
                )}
              </div>
              <div style={{ textAlign: 'right' }}>
                {e.payment && (
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                    {formatPrice(e.payment)}
                  </div>
                )}
                <button
                  className={e.payment ? 'primary' : 'ghost'}
                  style={{ padding: '4px 10px', fontSize: 11 }}
                  onClick={() => onUseEndpoint(e)}
                >
                  {e.payment ? 'Use & pay' : 'Use'}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
