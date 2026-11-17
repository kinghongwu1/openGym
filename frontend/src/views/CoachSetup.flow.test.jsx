// @vitest-environment happy-dom
// The mobile build's "how should the Coach run?" screen. CoachSetup.test.jsx already pins the
// promise about what this file may import; this one drives what it does.
//
// Two answers, and everything hard about them lives in the refusals: a server with no Coach on
// it, a phone with no key, a base URL that is not one, an endpoint that does not answer, and
// the two failures on "Save" that issue #42 was about — the settings write and the secure-store
// write, which the screen deliberately does in that order.
//
// coach-local.js is mocked here only so the DYNAMIC import inside prepare()/turnOff() resolves
// without a network stack. providers.js, categories.js and coach.js are the real ones, so the
// provider table, the validator and the category copy are exactly what ships.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CoachSetup from './CoachSetup.jsx'
import { getApiKey, setApiKey, clearApiKey } from '../lib/coach-secrets.js'
import { localModels, localForget } from '../lib/coach-local.js'
import { CATEGORY_TEXT } from '../lib/coach.js'
import { HTTP_PROVIDERS } from '../../../api/coach/core/providers.js'
import { DATA_CATEGORIES } from '../../../api/coach/core/categories.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = {
    mobile: true, user: null, config: null, coachLocal: null,
    nav: vi.fn(), toast: vi.fn(), openSheet: vi.fn(), setCoachLocal: vi.fn(), refreshConfig: vi.fn(),
  }
  state.snapshot = () => ({
    user: state.user, config: state.config, coachLocal: state.coachLocal,
    setCoachLocal: (...a) => state.setCoachLocal(...a),
    refreshConfig: (...a) => state.refreshConfig(...a),
  })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: (...a) => mocks.toast(...a), openSheet: (...a) => mocks.openSheet(...a) })
  const useUI = selector => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.nav }))
// A getter, so one test can be the web build and the rest the phone.
vi.mock('../lib/mobile.js', () => ({ get MOBILE() { return mocks.mobile } }))
vi.mock('../lib/coach-secrets.js', () => ({
  getApiKey: vi.fn(() => Promise.resolve(null)),
  setApiKey: vi.fn(() => Promise.resolve()),
  clearApiKey: vi.fn(() => Promise.resolve()),
}))
vi.mock('../lib/coach-local.js', () => ({
  localModels: vi.fn(() => Promise.resolve({ ok: true, models: [] })),
  localForget: vi.fn(() => Promise.resolve({ ok: true })),
}))
vi.mock('./MobileOnboarding.jsx', () => ({ ConnectSheet: () => <div className="connect-sheet" /> }))

let host, root
beforeEach(() => {
  mocks.mobile = true
  mocks.user = { uid: 'u1', name: 'Ana' }
  mocks.config = { coach: { enabled: true } }
  mocks.coachLocal = null
  mocks.nav.mockReset(); mocks.toast.mockReset(); mocks.openSheet.mockReset()
  mocks.setCoachLocal.mockReset().mockResolvedValue(undefined)
  mocks.refreshConfig.mockReset()
  vi.mocked(getApiKey).mockReset().mockResolvedValue(null)
  vi.mocked(setApiKey).mockReset().mockResolvedValue(undefined)
  vi.mocked(clearApiKey).mockReset().mockResolvedValue(undefined)
  vi.mocked(localModels).mockReset().mockResolvedValue({ ok: true, models: [] })
  vi.mocked(localForget).mockReset().mockResolvedValue({ ok: true })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const mount = async () => { await act(async () => { root.render(<CoachSetup />) }) }
const settle = async () => { await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve() }) }

const all = sel => [...host.querySelectorAll(sel)]
const rowTitled = title => all('.lrow').find(r => r.querySelector('.lrow-t')?.textContent === title)
const btn = text => all('.btn').find(b => b.textContent.trim() === text)
// A provider is a big card (its title) or, for the less common ones, a chip.
const chip = label => all('.cs-card').find(b => b.querySelector('.cs-card-t')?.textContent === label) || all('.chip').find(b => b.textContent.trim() === label)
const field = type => all('input').find(i => (i.getAttribute('type') || 'text') === type)
const click = el => { expect(el).toBeTruthy(); return act(() => el.click()) }
const typeIn = (el, value) => act(() => {
  Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
})
const pickModel = value => act(() => {
  const el = host.querySelector('select')
  Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('change', { bubbles: true }))
})
const openByok = async () => { await click(rowTitled('Bring my own API key')) }

describe('CoachSetup — where it runs at all', () => {
  it('is a phone screen: the web build is sent straight back to Settings', async () => {
    mocks.mobile = false
    await mount()
    expect(mocks.nav).toHaveBeenCalledWith('/settings', { replace: true })
  })

  it('re-asks the paired server what it can do, because the admin may have switched it on', async () => {
    await mount()
    expect(mocks.refreshConfig).toHaveBeenCalledTimes(1)
  })

  it('asks nothing of a server it is not signed in to', async () => {
    mocks.user = null; mocks.config = null
    await mount()
    expect(mocks.refreshConfig).not.toHaveBeenCalled()
  })
})

describe('CoachSetup — "use my self-hosted openGym"', () => {
  it('hands the Coach to the server and leaves for the conversation', async () => {
    await mount()
    await click(rowTitled('Use my self-hosted openGym'))
    await settle()
    expect(mocks.setCoachLocal).toHaveBeenCalledWith({ mode: 'server' })
    expect(mocks.toast).toHaveBeenCalledWith('The Coach is on')
    expect(mocks.nav).toHaveBeenCalledWith('/coach')
  })

  it('an unpaired phone is asked to connect first, and nothing is written', async () => {
    mocks.user = null; mocks.config = null
    await mount()
    expect(rowTitled('Use my self-hosted openGym').textContent).toContain('Connect to my server')
    await click(rowTitled('Use my self-hosted openGym'))
    expect(mocks.openSheet).toHaveBeenCalledTimes(1)
    expect(mocks.setCoachLocal).not.toHaveBeenCalled()
    expect(mocks.nav).not.toHaveBeenCalled()
  })

  it('a paired server with no Coach on it refuses, explains, and writes nothing', async () => {
    mocks.config = { coach: { enabled: false } }
    await mount()
    const row = rowTitled('Use my self-hosted openGym')
    expect(row.textContent).toContain('Your server has no Coach enabled')
    await click(row)
    expect(mocks.setCoachLocal).not.toHaveBeenCalled()
    expect(mocks.nav).not.toHaveBeenCalled()
    expect(host.querySelector('.card').textContent).toContain('Ask its admin, or bring your own key below')
  })

  it('says it is still asking while the server has not answered yet', async () => {
    mocks.config = null
    await mount()
    expect(rowTitled('Use my self-hosted openGym').textContent).toContain('Loading…')
  })

  it('Back returns to Settings', async () => {
    await mount()
    await click(host.querySelector('.hdr .iconbtn'))
    expect(mocks.nav).toHaveBeenCalledWith('/settings')
  })
})

describe('CoachSetup — bringing your own key', () => {
  it('offers DeepSeek and no other provider', async () => {
    await mount(); await openByok()
    const shown = all('.chip').map(c => c.textContent)
    expect(shown).toEqual(['DeepSeek API'])
    expect(chip('DeepSeek API').classList.contains('on')).toBe(true)
    expect(host.textContent).not.toContain('Anthropic API')
    expect(host.textContent).not.toContain('OpenAI API')
    expect(host.textContent).not.toContain('OpenRouter')
    expect(host.textContent).not.toContain('Daily runs')
    expect(rowTitled('Get a key from DeepSeek API')).toBeTruthy()
  })

  it('a pasted key stays on DeepSeek and is tested there', async () => {
    await mount(); await openByok()
    await typeIn(field('password'), 'sk-' + 'B'.repeat(40))
    await settle()
    expect(chip('DeepSeek API').classList.contains('on')).toBe(true)
    expect(mocks.toast).not.toHaveBeenCalled()
    expect(localModels).toHaveBeenCalledWith({ provider: 'deepseek', baseUrl: null }, 'sk-' + 'B'.repeat(40))
  })

  it('names every category the payload is built from, in that order, and where it would go', async () => {
    await mount(); await openByok()
    const section = all('.sect').find(s => s.querySelector('.sect-t')?.textContent === 'What leaves this phone')
    expect([...section.querySelectorAll('.lrow-t')].map(t => t.textContent))
      .toEqual(DATA_CATEGORIES.map(k => CATEGORY_TEXT[k]()[0]))
    expect(host.textContent).toContain('Each request goes straight to api.deepseek.com with your key')
  })

  it('has no endpoint field: DeepSeek’s base URL is fixed', async () => {
    await mount(); await openByok()
    expect(host.textContent).not.toContain('Endpoint')
    expect(host.textContent).toContain('Each request goes straight to api.deepseek.com with your key')
  })

  it('refuses to reach out with no key, and never loads the pipeline to find out', async () => {
    await mount(); await openByok()
    await click(btn('Test it')); await settle()
    expect(mocks.toast).toHaveBeenCalledWith('Enter your API key')
    expect(localModels).not.toHaveBeenCalled()
    expect(host.querySelector('.card')).toBe(null)          // no progress steps started
  })

  it('a key already in the phone’s store counts — the field says so and stays optional', async () => {
    vi.mocked(getApiKey).mockResolvedValue('sk-saved')
    await mount(); await settle(); await openByok()
    expect(field('password').getAttribute('placeholder')).toContain('(saved)')
    await click(btn('Test it')); await settle()
    expect(localModels).toHaveBeenCalledWith({ provider: 'deepseek', baseUrl: null }, 'sk-saved')
  })

  it('a typed key wins over the saved one and is never read back out of storage', async () => {
    vi.mocked(getApiKey).mockResolvedValue('sk-saved')
    await mount(); await settle(); await openByok()
    typeIn(field('password'), '  sk-typed  ')
    await click(btn('Test it')); await settle()
    expect(localModels).toHaveBeenCalledWith({ provider: 'deepseek', baseUrl: null }, 'sk-typed')
  })
})

describe('CoachSetup — listing the models', () => {
  const withKey = async () => {
    await mount(); await openByok()
    typeIn(field('password'), 'sk-1')
  }

  it('walks the three steps, lists what the endpoint serves and pre-picks the default', async () => {
    vi.mocked(localModels).mockResolvedValue({ ok: true, models: ['deepseek-flash', 'deepseek-v4-pro'] })
    await withKey()
    await click(btn('Test it')); await settle()

    expect(all('.card .small').map(s => s.textContent))
      .toEqual(['Loading the exercise catalogue…', 'Checking the endpoint…', 'Ready'])
    const select = host.querySelector('select')
    expect([...select.options].map(o => o.value)).toEqual(['', 'deepseek-flash', 'deepseek-v4-pro'])
    expect(select.value).toBe('deepseek-flash')
    expect(btn('Save and use the Coach')).toBeTruthy()
    expect(btn('Test it')).toBeTruthy()                 // still there, to re-list
  })

  it('leaves the model unchosen when the endpoint does not serve the default', async () => {
    vi.mocked(localModels).mockResolvedValue({ ok: true, models: ['qwen3-27b'] })
    await withKey()
    await click(btn('Test it')); await settle()
    expect(host.querySelector('select').value).toBe('')
    expect(host.querySelector('select option').textContent).toBe('(deepseek-flash)')
  })

  it('an endpoint that will not answer clears the progress and says why', async () => {
    vi.mocked(localModels).mockResolvedValue({ ok: false, error: 'connection refused' })
    await withKey()
    await click(btn('Test it')); await settle()
    expect(mocks.toast).toHaveBeenCalledWith('Could not reach the provider: connection refused')
    expect(host.querySelector('.card')).toBe(null)
    expect(host.querySelector('select')).toBe(null)
    expect(btn('Test it').disabled).toBe(false)          // and you can try again
  })

  it('a thrown failure is reported in its own words', async () => {
    vi.mocked(localModels).mockRejectedValue(new Error('secure storage timed out'))
    await withKey()
    await click(btn('Test it')); await settle()
    expect(mocks.toast).toHaveBeenCalledWith('secure storage timed out')
    expect(host.querySelector('.card')).toBe(null)
  })

  it('a thrown failure with nothing to say still says something', async () => {
    vi.mocked(localModels).mockRejectedValue(new Error())
    await withKey()
    await click(btn('Test it')); await settle()
    expect(mocks.toast).toHaveBeenCalledWith('Could not connect')
  })

  it('re-testing stays on DeepSeek', async () => {
    vi.mocked(localModels).mockResolvedValue({ ok: true, models: [HTTP_PROVIDERS.deepseek.defaultModel] })
    await withKey()
    await click(btn('Test it')); await settle()
    expect(localModels).toHaveBeenLastCalledWith({ provider: 'deepseek', baseUrl: null }, 'sk-1')
    expect(host.querySelector('select').value).toBe(HTTP_PROVIDERS.deepseek.defaultModel)
  })
})

describe('CoachSetup — saving', () => {
  const listed = async (models, { key = 'sk-1' } = {}) => {
    await mount(); await openByok()
    if (key) typeIn(field('password'), key)
    vi.mocked(localModels).mockResolvedValue({ ok: true, models })
    await click(btn('Test it')); await settle()
  }

  it('writes the mode, the provider and the chosen model, then stores the key and leaves', async () => {
    await listed(['deepseek-flash', 'deepseek-v4-pro'])
    await click(btn('Save and use the Coach')); await settle()
    expect(mocks.setCoachLocal).toHaveBeenCalledWith({ mode: 'byok', provider: 'deepseek', model: 'deepseek-flash', baseUrl: null })
    expect(setApiKey).toHaveBeenCalledWith('sk-1')
    expect(mocks.toast).toHaveBeenCalledWith('The Coach is on')
    expect(mocks.nav).toHaveBeenCalledWith('/coach')
  })

  it('does not touch the secure store when the key field was left alone', async () => {
    vi.mocked(getApiKey).mockResolvedValue('sk-saved')
    await mount(); await settle(); await openByok()
    vi.mocked(localModels).mockResolvedValue({ ok: true, models: ['deepseek-flash'] })
    await click(btn('Test it')); await settle()
    await click(btn('Save and use the Coach')); await settle()
    expect(setApiKey).not.toHaveBeenCalled()
    expect(mocks.nav).toHaveBeenCalledWith('/coach')
  })

  // Issue #42: both of these used to leave the button greyed out for ever with no explanation.
  it('a settings write that fails says so, keeps you here and never stores the key', async () => {
    await listed(['deepseek-flash'])
    mocks.setCoachLocal.mockRejectedValueOnce(new Error('could not write the settings file'))
    await click(btn('Save and use the Coach')); await settle()
    expect(mocks.toast).toHaveBeenCalledWith('could not write the settings file')
    expect(setApiKey).not.toHaveBeenCalled()
    expect(mocks.nav).not.toHaveBeenCalled()
    expect(btn('Save and use the Coach').disabled).toBe(false)
  })

  it('a secure-store write that fails says so — but the mode is already on, by design', async () => {
    await listed(['deepseek-flash'])
    vi.mocked(setApiKey).mockRejectedValueOnce(new Error('secure storage timed out'))
    await click(btn('Save and use the Coach')); await settle()
    expect(mocks.setCoachLocal).toHaveBeenCalledWith(expect.objectContaining({ mode: 'byok' }))
    expect(mocks.toast).toHaveBeenCalledWith('secure storage timed out')
    expect(mocks.nav).not.toHaveBeenCalled()
    expect(btn('Save and use the Coach').disabled).toBe(false)
  })
})

describe('CoachSetup — turning it off', () => {
  it('offers the control only once the Coach is actually on', async () => {
    await mount()
    expect(rowTitled('Turn the Coach off on this phone')).toBeUndefined()
    expect(host.textContent).toContain('Off. Choose how the Coach should run.')
  })

  it('says which way it is running now', async () => {
    mocks.coachLocal = { mode: 'server' }
    await mount()
    expect(host.textContent).toContain('Runs on your openGym server')
    expect(rowTitled('Turn the Coach off on this phone')).toBeTruthy()
  })

  it('forgets the key, the mode and everything the pipeline was holding', async () => {
    mocks.coachLocal = { mode: 'byok', provider: 'openai', model: 'gpt-5.6' }
    await mount()
    expect(host.textContent).toContain('Runs on this phone with your own API key')

    await click(rowTitled('Turn the Coach off on this phone')); await settle()
    expect(clearApiKey).toHaveBeenCalledTimes(1)
    expect(mocks.setCoachLocal).toHaveBeenCalledWith({ mode: 'off' })
    expect(localForget).toHaveBeenCalledTimes(1)
    expect(mocks.toast).toHaveBeenCalledWith('The Coach is off')
    expect(mocks.nav).not.toHaveBeenCalled()                          // you stay on the screen
  })

  it('starts the key picker on DeepSeek even if the phone had another provider saved', async () => {
    mocks.coachLocal = { mode: 'byok', provider: 'openai', model: 'gpt-5.6' }
    await mount(); await openByok()
    expect(chip('DeepSeek API').classList.contains('on')).toBe(true)
    expect(chip('OpenAI API')).toBeUndefined()
    expect(field('password').getAttribute('placeholder')).toBe('sk-…')
  })
})
