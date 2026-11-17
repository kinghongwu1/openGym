// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ toast: vi.fn(), localModels: vi.fn(async () => ({ ok: true, models: ['deepseek-flash'] })), setCoachLocal: vi.fn(async () => {}) }))

vi.mock('../store/useStore.js', () => {
  const snap = () => ({ user: null, config: null, coachLocal: null, setCoachLocal: mocks.setCoachLocal, refreshConfig: vi.fn() })
  const useStore = selector => selector ? selector(snap()) : snap()
  useStore.getState = snap
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: (...a) => mocks.toast(...a), openSheet: vi.fn() })
  const useUI = selector => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../lib/mobile.js', () => ({ MOBILE: true }))
vi.mock('../lib/coach-secrets.js', () => ({ getApiKey: async () => null, setApiKey: vi.fn(async () => {}), clearApiKey: vi.fn(async () => {}) }))
vi.mock('../lib/coach-local.js', () => ({ localModels: (...a) => mocks.localModels(...a), localForget: vi.fn() }))
vi.mock('./MobileOnboarding.jsx', () => ({ ConnectSheet: () => null }))

const { default: CoachSetup } = await import('./CoachSetup.jsx')

const mounted = []
function mount(el) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push({ root, host })
  act(() => root.render(el))
  return host
}
afterEach(() => { act(() => { mounted.splice(0).forEach(({ root, host }) => { root.unmount(); host.remove() }) }) })

const settle = () => act(() => new Promise(r => setTimeout(r, 0)))
const rowByTitle = (el, title) => [...el.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === title)

describe('CoachSetup offers DeepSeek only', () => {
  it('has no endpoint to point at another host', async () => {
    const page = mount(<CoachSetup />)
    await settle()
    act(() => rowByTitle(page, 'Bring my own API key').click())
    expect(page.textContent).toContain('DeepSeek API')
    expect(page.textContent).not.toContain('Endpoint')
    expect(page.textContent).not.toContain('OpenAI-compatible')
    expect([...page.querySelectorAll('button.chip')].map(b => b.textContent)).toEqual(['DeepSeek API'])
  })
})
