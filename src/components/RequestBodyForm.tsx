import type { Field } from '../lib/forms'
import { defaultValueFor } from '../lib/forms'

type AnyVal = unknown

function getAt(obj: AnyVal, path: string): AnyVal {
  if (!path) return obj
  const parts = path.split('.')
  let cur: AnyVal = obj
  for (const p of parts) {
    if (cur == null) return undefined
    cur = (cur as Record<string, AnyVal>)[p]
  }
  return cur
}

function setAt(obj: AnyVal, path: string, value: AnyVal): AnyVal {
  if (!path) return value
  const parts = path.split('.')
  const root: Record<string, AnyVal> =
    obj && typeof obj === 'object' && !Array.isArray(obj) ? { ...(obj as Record<string, AnyVal>) } : {}
  let cur = root
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]
    const existing = cur[key]
    cur[key] =
      existing && typeof existing === 'object' && !Array.isArray(existing)
        ? { ...(existing as Record<string, AnyVal>) }
        : {}
    cur = cur[key] as Record<string, AnyVal>
  }
  cur[parts[parts.length - 1]] = value
  return root
}

function unsetAt(obj: AnyVal, path: string): AnyVal {
  if (!path) return undefined
  const parts = path.split('.')
  if (!obj || typeof obj !== 'object') return obj
  const root: Record<string, AnyVal> = { ...(obj as Record<string, AnyVal>) }
  let cur = root
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]
    if (!cur[key] || typeof cur[key] !== 'object') return root
    cur[key] = { ...(cur[key] as Record<string, AnyVal>) }
    cur = cur[key] as Record<string, AnyVal>
  }
  delete cur[parts[parts.length - 1]]
  return root
}

export function RequestBodyForm({
  fields,
  value,
  onChange,
}: {
  fields: Field[]
  value: AnyVal
  onChange: (next: AnyVal) => void
}) {
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {fields.map((f) => (
        <FieldInput
          key={f.path}
          field={f}
          value={getAt(value, f.path)}
          isPresent={isPresentAt(value, f.path)}
          onChange={(v) => onChange(setAt(value, f.path, v))}
          onClear={() => onChange(unsetAt(value, f.path))}
        />
      ))}
    </div>
  )
}

function isPresentAt(obj: AnyVal, path: string): boolean {
  if (!path) return obj !== undefined
  const parts = path.split('.')
  let cur: AnyVal = obj
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return false
    if (!(p in (cur as Record<string, AnyVal>))) return false
    cur = (cur as Record<string, AnyVal>)[p]
  }
  return true
}

function FieldInput({
  field,
  value,
  isPresent,
  onChange,
  onClear,
}: {
  field: Field
  value: AnyVal
  isPresent: boolean
  onChange: (v: AnyVal) => void
  onClear: () => void
}) {
  const labelEl = (
    <div className="row between" style={{ alignItems: 'baseline', gap: 8 }}>
      <label style={{ margin: 0 }}>
        {field.label}
        {field.required && <span style={{ color: 'var(--accent)', marginLeft: 4 }}>*</span>}
      </label>
      {!field.required && isPresent && (
        <button
          type="button"
          className="ghost"
          style={{ padding: '0 6px', fontSize: 10, background: 'transparent', border: 0 }}
          onClick={onClear}
        >
          ✕
        </button>
      )}
    </div>
  )

  const description =
    field.description &&
    field.description.length < 200 && (
      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>{field.description}</div>
    )

  switch (field.kind) {
    case 'string': {
      if (field.enumValues && field.enumValues.length > 0) {
        return (
          <div>
            {labelEl}
            <select
              value={(value as string | undefined) ?? ''}
              onChange={(e) => onChange(e.target.value || undefined)}
            >
              <option value="">—</option>
              {field.enumValues.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            {description}
          </div>
        )
      }
      const isMultiline = field.multiline
      return (
        <div>
          {labelEl}
          {isMultiline ? (
            <textarea
              rows={3}
              value={(value as string | undefined) ?? ''}
              onChange={(e) => onChange(e.target.value)}
              placeholder={field.placeholder ?? ''}
            />
          ) : (
            <input
              type={inputTypeForFormat(field.format)}
              value={(value as string | undefined) ?? ''}
              onChange={(e) => onChange(e.target.value)}
              placeholder={field.placeholder ?? ''}
              spellCheck={false}
            />
          )}
          {description}
        </div>
      )
    }
    case 'number': {
      const v = value === null || value === undefined ? '' : String(value)
      return (
        <div>
          {labelEl}
          <input
            type="number"
            inputMode={field.integer ? 'numeric' : 'decimal'}
            value={v}
            min={field.min}
            max={field.max}
            step={field.integer ? 1 : 'any'}
            onChange={(e) => {
              const text = e.target.value
              if (text === '') return onChange(null)
              const num = field.integer ? Number.parseInt(text, 10) : Number(text)
              onChange(Number.isNaN(num) ? null : num)
            }}
          />
          {description}
        </div>
      )
    }
    case 'boolean':
      return (
        <div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
            <input
              type="checkbox"
              checked={Boolean(value)}
              onChange={(e) => onChange(e.target.checked)}
              style={{ width: 'auto' }}
            />
            <span>
              {field.label}
              {field.required && <span style={{ color: 'var(--accent)', marginLeft: 4 }}>*</span>}
            </span>
          </label>
          {description}
        </div>
      )
    case 'enum':
      return (
        <div>
          {labelEl}
          <select
            value={value === undefined || value === null ? '' : String(value)}
            onChange={(e) => {
              const text = e.target.value
              if (text === '') return onChange(undefined)
              const match = field.values.find((v) => String(v) === text)
              onChange(match ?? text)
            }}
          >
            {!field.required && <option value="">—</option>}
            {field.values.map((v) => (
              <option key={String(v)} value={String(v)}>
                {String(v)}
              </option>
            ))}
          </select>
          {description}
        </div>
      )
    case 'object':
      return (
        <fieldset
          style={{
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: 12,
            margin: 0,
          }}
        >
          <legend style={{ fontSize: 12, color: 'var(--text-dim)', padding: '0 6px' }}>
            {field.label}
            {field.required && <span style={{ color: 'var(--accent)', marginLeft: 4 }}>*</span>}
          </legend>
          {description}
          <div style={{ display: 'grid', gap: 10, marginTop: 8 }}>
            {field.fields.map((child) => {
              const relPath = child.path.slice(field.path.length + 1)
              const rebased: Field = { ...child, path: relPath }
              const childObj =
                value && typeof value === 'object' && !Array.isArray(value) ? value : {}
              return (
                <FieldInput
                  key={child.path}
                  field={rebased}
                  value={getAt(childObj, relPath)}
                  isPresent={isPresentAt(childObj, relPath)}
                  onChange={(v) => onChange(setAt(childObj, relPath, v))}
                  onClear={() => onChange(unsetAt(childObj, relPath))}
                />
              )
            })}
          </div>
        </fieldset>
      )
    case 'array': {
      const arr = Array.isArray(value) ? value : []
      return (
        <div>
          {labelEl}
          <div style={{ display: 'grid', gap: 8 }}>
            {arr.map((item, idx) => {
              const itemField: Field = { ...field.itemField, path: '__item__' }
              return (
                <div key={idx} className="row" style={{ gap: 6, alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <FieldInput
                      field={itemField}
                      value={item}
                      isPresent={item !== undefined}
                      onChange={(v) => {
                        const next = [...arr]
                        next[idx] = v
                        onChange(next)
                      }}
                      onClear={() => {
                        const next = [...arr]
                        next.splice(idx, 1)
                        onChange(next.length === 0 ? undefined : next)
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    className="ghost"
                    style={{ padding: '4px 8px', fontSize: 11 }}
                    onClick={() => {
                      const next = [...arr]
                      next.splice(idx, 1)
                      onChange(next.length === 0 ? undefined : next)
                    }}
                  >
                    Remove
                  </button>
                </div>
              )
            })}
            <button
              type="button"
              className="ghost"
              style={{ padding: '6px 10px', fontSize: 11, alignSelf: 'flex-start' }}
              onClick={() => onChange([...arr, defaultValueFor(field.itemField)])}
            >
              + Add item
            </button>
          </div>
          {description}
        </div>
      )
    }
    case 'json':
      return (
        <div>
          {labelEl}
          <textarea
            rows={4}
            value={typeof value === 'string' ? value : value === undefined ? '' : JSON.stringify(value, null, 2)}
            onChange={(e) => onChange(e.target.value)}
            placeholder='{"key": "value"}'
          />
          {description}
        </div>
      )
  }
}

function inputTypeForFormat(format?: string): string {
  switch (format) {
    case 'email':
      return 'email'
    case 'uri':
    case 'url':
      return 'url'
    case 'date':
      return 'date'
    case 'date-time':
      return 'datetime-local'
    case 'password':
      return 'password'
    default:
      return 'text'
  }
}
