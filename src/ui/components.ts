// Tiny DOM helpers — no framework, just createElement with attributes,
// event listeners, and nested children.

export type Child = Node | string | null | undefined | Child[]

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | EventListener | null | undefined> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue
    if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener)
    } else if (v === true) {
      el.setAttribute(k, '')
    } else {
      el.setAttribute(k, String(v))
    }
  }
  appendChildren(el, children)
  return el
}

function appendChildren(el: HTMLElement, children: Child[]): void {
  for (const c of children) {
    if (c == null) continue
    if (Array.isArray(c)) appendChildren(el, c)
    else el.append(c)
  }
}

/** '—' for null/NaN, fixed decimals + optional unit otherwise. */
export function fmt(x: number | null | undefined, digits = 1, unit = ''): string {
  if (x == null || !Number.isFinite(x)) return '—'
  return x.toFixed(digits) + unit
}

export function metricCard(
  label: string,
  value: string,
  sub?: string,
  tone?: 'accent' | 'warn',
): HTMLElement {
  return h(
    'div',
    { class: `metric-card${tone ? ` metric-${tone}` : ''}` },
    h('div', { class: 'metric-label' }, label),
    h('div', { class: 'metric-value' }, value),
    sub ? h('div', { class: 'metric-sub' }, sub) : null,
  )
}

export function statusChip(label: string, state: 'ok' | 'warn' | 'err' | 'idle'): HTMLElement {
  return h('span', { class: 'chip', 'data-state': state }, label)
}
