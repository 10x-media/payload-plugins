import { describe, expect, it } from 'vitest'
import { retargetSecrets } from './retarget'

const SEALED = 'pfe1.sealed'

const hook = retargetSecrets({ scopeField: 'tenant', isSealed: (value) => value === SEALED })

type Doc = Record<string, unknown>

const stored: Doc = {
	provider: 'plausible',
	tenant: '7',
	plausible: { host: 'https://plausible.example.com', siteId: 'site.test', apiKey: SEALED },
	umami: { host: null, websiteId: 'w', apiKey: SEALED, token: SEALED },
	ga4: { propertyId: '1', projectId: 'p', clientEmail: 'a@b.iam', privateKey: SEALED },
	posthog: { host: null, region: 'eu', projectId: '9', scopeProperty: 'tenant', apiKey: SEALED },
}

/** The data an update hands the hook: the stored document, refilled, with `changes` over it. */
const update = (changes: (doc: Doc) => void): Doc => {
	const data = structuredClone(stored)
	changes(data)
	return data
}

const run = (data: Doc, operation: 'create' | 'update' = 'update'): Doc =>
	hook({ data, originalDoc: stored, operation, req: {} } as never) as Doc

const group = (doc: Doc, name: string): Doc => doc[name] as Doc

describe('retargetSecrets', () => {
	it('keeps every secret while nothing that decides the destination changed', () => {
		const data = update((doc) => {
			doc.name = 'Renamed'
		})
		expect(run(data)).toEqual(data)
	})

	it('clears a kept key when the host changes and leaves the other providers alone', () => {
		const result = run(
			update((doc) => {
				group(doc, 'plausible').host = 'https://elsewhere.example.com'
			})
		)
		expect(group(result, 'plausible').apiKey).toBeNull()
		expect(group(result, 'umami').apiKey).toBe(SEALED)
		expect(group(result, 'posthog').apiKey).toBe(SEALED)
	})

	it('clears a kept key when the site id changes', () => {
		const result = run(
			update((doc) => {
				group(doc, 'plausible').siteId = 'other.test'
			})
		)
		expect(group(result, 'plausible').apiKey).toBeNull()
	})

	it('clears a key the request left out or sent empty', () => {
		for (const apiKey of [undefined, '']) {
			const result = run(
				update((doc) => {
					group(doc, 'plausible').siteId = 'other.test'
					group(doc, 'plausible').apiKey = apiKey
				})
			)
			expect(group(result, 'plausible').apiKey).toBeNull()
		}
	})

	it('keeps a key the request sent again in plaintext', () => {
		const result = run(
			update((doc) => {
				group(doc, 'plausible').host = 'https://elsewhere.example.com'
				group(doc, 'plausible').apiKey = 'fresh-key'
			})
		)
		expect(group(result, 'plausible').apiKey).toBe('fresh-key')
	})

	it('clears both umami secrets when its website changes', () => {
		const result = run(
			update((doc) => {
				group(doc, 'umami').websiteId = 'other'
			})
		)
		expect(group(result, 'umami').apiKey).toBeNull()
		expect(group(result, 'umami').token).toBeNull()
	})

	it('clears the ga4 key when the service account or property changes', () => {
		for (const [field, value] of [
			['clientEmail', 'evil@x.iam'],
			['propertyId', '2'],
			['projectId', 'q'],
		] as const) {
			const result = run(
				update((doc) => {
					group(doc, 'ga4')[field] = value
				})
			)
			expect(group(result, 'ga4').privateKey).toBeNull()
		}
	})

	it('clears the posthog key when its region, project or scope property changes', () => {
		for (const [field, value] of [
			['region', 'us'],
			['projectId', '10'],
			['scopeProperty', 'site'],
			['host', 'https://posthog.example.com'],
		] as const) {
			const result = run(
				update((doc) => {
					group(doc, 'posthog')[field] = value
				})
			)
			expect(group(result, 'posthog').apiKey).toBeNull()
		}
	})

	it("clears the other providers' kept secrets when the provider changes", () => {
		const result = run(
			update((doc) => {
				doc.provider = 'umami'
				group(doc, 'umami').apiKey = 'umami-fresh'
			})
		)
		expect(group(result, 'plausible').apiKey).toBeNull()
		expect(group(result, 'ga4').privateKey).toBeNull()
		expect(group(result, 'posthog').apiKey).toBeNull()
		expect(group(result, 'umami').apiKey).toBe('umami-fresh')
		expect(group(result, 'umami').token).toBeNull()
	})

	it('clears every kept secret when the document moves to another scope', () => {
		const result = run(
			update((doc) => {
				doc.tenant = { id: 8 }
			})
		)
		expect(group(result, 'plausible').apiKey).toBeNull()
		expect(group(result, 'posthog').apiKey).toBeNull()
	})

	it('reads a populated relationship as its id, so an unchanged tenant clears nothing', () => {
		const data = update((doc) => {
			doc.tenant = { id: 7 }
		})
		expect(run(data)).toBe(data)
	})

	it('treats blank, absent and whitespace as one unchanged value', () => {
		const data = update((doc) => {
			group(doc, 'umami').host = ''
			group(doc, 'plausible').siteId = ' site.test '
		})
		expect(run(data)).toBe(data)
	})

	it('counts a value the request left out as unchanged', () => {
		const data = update((doc) => {
			group(doc, 'plausible').host = undefined
		})
		expect(run(data)).toBe(data)
	})

	it('counts clearing a host back to the vendor cloud as a retarget', () => {
		const result = run(
			update((doc) => {
				group(doc, 'plausible').host = null
			})
		)
		expect(group(result, 'plausible').apiKey).toBeNull()
	})

	it('never touches a create', () => {
		const data = update((doc) => {
			group(doc, 'plausible').host = 'https://elsewhere.example.com'
		})
		expect(run(data, 'create')).toBe(data)
	})

	it('leaves a secret alone whose group the request did not carry', () => {
		const data = update((doc) => {
			doc.provider = 'posthog'
			doc.plausible = undefined
		})
		const result = run(data)
		expect(result.plausible).toBeUndefined()
		expect(group(result, 'posthog').apiKey).toBeNull()
	})
})
