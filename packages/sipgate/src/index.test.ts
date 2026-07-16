import type { Config } from 'payload'
import { describe, expect, it } from 'vitest'

import { sipgate } from './index'

const fakeConfig = () => ({ collections: [] }) as unknown as Config

const fakeConfigWithContacts = () =>
	({
		collections: [{ slug: 'contacts', fields: [] }],
	}) as unknown as Config

describe('sipgate factory', () => {
	it('returns a Payload plugin function', () => {
		expect(typeof sipgate({})).toBe('function')
	})

	it('returns the incoming config when disabled', () => {
		const cfg = fakeConfig()
		expect(sipgate({ disabled: true })(cfg)).toBe(cfg)
	})

	it('throws when oauth2 is enabled without webhookUrl', () => {
		expect(() =>
			sipgate({
				sipgateCredentials: {
					authType: 'oauth2',
					clientId: 'id',
					clientSecret: 'secret',
				},
			})(fakeConfig())
		).toThrow(/webhookUrl is required/)
	})

	it('throws when ivr is enabled without webhookUrl', () => {
		expect(() => sipgate({ ivr: true })(fakeConfig())).toThrow(/webhookUrl is required/)
	})

	it('registers authenticated access on core collections', () => {
		const result = sipgate({})(fakeConfig()) as Config
		for (const slug of ['call-logs', 'sipgate-users', 'sipgate-devices', 'sipgate-channels']) {
			const collection = result.collections?.find((c) => c.slug === slug)
			expect(collection?.access?.read).toBeTypeOf('function')
			expect(collection?.access?.create).toBeTypeOf('function')
		}
	})
})

describe('enableContactMatchUi option', () => {
	it('injects the contactMatchUi field when enableContactMatchUi is true', () => {
		const result = sipgate({
			contactCollections: ['contacts'],
			phoneNumberFields: [],
			enableContactMatchUi: true,
		})(fakeConfigWithContacts()) as Config

		const contacts = result.collections?.find((c) => c.slug === 'contacts')
		const hasField = contacts?.fields.some(
			(f: unknown) =>
				typeof f === 'object' &&
				f !== null &&
				'name' in f &&
				(f as { name: string }).name === 'contactMatchUi'
		)
		expect(hasField).toBe(true)
	})

	it('does not inject the contactMatchUi field when enableContactMatchUi is false', () => {
		const result = sipgate({
			contactCollections: ['contacts'],
			phoneNumberFields: [],
			enableContactMatchUi: false,
		})(fakeConfigWithContacts()) as Config

		const contacts = result.collections?.find((c) => c.slug === 'contacts')
		const hasField = contacts?.fields.some(
			(f: unknown) =>
				typeof f === 'object' &&
				f !== null &&
				'name' in f &&
				(f as { name: string }).name === 'contactMatchUi'
		)
		expect(hasField).toBe(false)
	})

	it('does not inject the contactMatchUi field when enableContactMatchUi is omitted', () => {
		const result = sipgate({
			contactCollections: ['contacts'],
			phoneNumberFields: [],
		})(fakeConfigWithContacts()) as Config

		const contacts = result.collections?.find((c) => c.slug === 'contacts')
		const hasField = contacts?.fields.some(
			(f: unknown) =>
				typeof f === 'object' &&
				f !== null &&
				'name' in f &&
				(f as { name: string }).name === 'contactMatchUi'
		)
		expect(hasField).toBe(false)
	})
})
