import { beforeEach, describe, expect, it } from 'vitest'
import { createScriptLoader } from './loadScript'

const injected = (): HTMLScriptElement[] => [...document.head.querySelectorAll('script')]

beforeEach(() => {
	document.head.innerHTML = ''
})

describe('createScriptLoader', () => {
	it('injects a src script with its attributes and resolves on load', async () => {
		const load = createScriptLoader(window, 'nonce-123')
		const pending = load({
			src: '/api/analytics/p/tenant/script.js',
			defer: true,
			attrs: { 'data-website-id': 'abc', 'data-host-url': '/api/analytics/p/tenant' },
		})

		const [el] = injected()
		expect(el).toBeDefined()
		expect(el?.getAttribute('src')).toBe('/api/analytics/p/tenant/script.js')
		expect(el?.defer).toBe(true)
		expect(el?.async).toBe(false)
		expect(el?.getAttribute('data-website-id')).toBe('abc')
		expect(el?.getAttribute('nonce')).toBe('nonce-123')

		el?.dispatchEvent(new Event('load'))
		await expect(pending).resolves.toBeUndefined()
	})

	it('rejects when the script errors', async () => {
		const load = createScriptLoader(window)
		const pending = load({ src: '/blocked.js', async: true })
		const [el] = injected()
		expect(el?.async).toBe(true)

		el?.dispatchEvent(new Event('error'))
		await expect(pending).rejects.toThrow('/blocked.js')
	})

	it('resolves an inline script without waiting for an event', async () => {
		const load = createScriptLoader(window)
		await load({ inline: 'window.__analyticsBooted = true' })

		expect(injected()[0]?.textContent).toBe('window.__analyticsBooted = true')
	})

	it('does not re-inject a script the page already carries', async () => {
		const existing = document.createElement('script')
		existing.src = '/api/analytics/p/global/static/array.js'
		document.head.appendChild(existing)
		const inline = document.createElement('script')
		inline.text = 'window.__analyticsBooted = true'
		document.head.appendChild(inline)

		const load = createScriptLoader(window)
		await load({ src: '/api/analytics/p/global/static/array.js' })
		await load({ inline: 'window.__analyticsBooted = true' })

		expect(injected()).toHaveLength(2)
	})

	it('resolves a script with neither src nor inline', async () => {
		const load = createScriptLoader(window)
		await load({})

		expect(injected()).toHaveLength(0)
	})
})
