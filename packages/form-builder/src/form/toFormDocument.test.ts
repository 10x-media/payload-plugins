import { describe, expect, expectTypeOf, it } from 'vitest'
import { toFormDocument } from './toFormDocument'

/**
 * The shape `payload generate:types` writes for a forms collection whose blocks set an
 * `interfaceName`: each block is an interface, which has no implicit index signature.
 */
interface GeneratedTextBlock {
	name: string
	label?: string | null
	required?: boolean | null
	id?: string | null
	blockName?: string | null
	blockType: 'text'
}

interface GeneratedMessageBlock {
	message?: { root: { type: string; [k: string]: unknown } } | null
	id?: string | null
	blockName?: string | null
	blockType: 'message'
}

interface GeneratedForm {
	id: string
	title?: string | null
	multistep?: boolean | null
	pollEnabled?: boolean | null
	fields?: (GeneratedTextBlock | GeneratedMessageBlock)[] | null
	submitLabel?: string | null
	poll?: {
		resultsField?: string | null
		resultsVisibility?: ('afterVote' | 'afterClose') | null
		closesAt?: string | null
		outcome?: { winningValues?: string[] | null; resolvedAt?: string | null }
	}
	response?: {
		type?: ('message' | 'redirect') | null
		message?: { root: { type: string; [k: string]: unknown } } | null
		redirect?: { url?: string | null }
	}
	updatedAt: string
	createdAt: string
}

describe('toFormDocument', () => {
	it('coerces a null response to undefined', () => {
		const doc = toFormDocument({ id: 1, fields: [], response: null })
		expect(doc.response).toBeUndefined()
	})

	it('passes the title through, null- and omission-coerced to undefined', () => {
		expect(toFormDocument({ id: 1, title: 'Contact us' }).title).toBe('Contact us')
		expect(toFormDocument({ id: 1, title: null }).title).toBeUndefined()
		expect(toFormDocument({ id: 1 }).title).toBeUndefined()
	})

	it('defaults fields to an empty array and leaves response undefined when omitted', () => {
		const doc = toFormDocument({ id: 1 })
		expect(doc.fields).toEqual([])
		expect(doc.response).toBeUndefined()
	})

	it('reassembles buttons from the top-level label fields', () => {
		const doc = toFormDocument({ id: 1, fields: [], submitLabel: 'Send', nextLabel: 'Continue' })
		expect(doc.buttons).toEqual({ submitLabel: 'Send', nextLabel: 'Continue' })
	})

	it('leaves buttons undefined when no non-empty label is set', () => {
		expect(toFormDocument({ id: 1, submitLabel: null }).buttons).toBeUndefined()
		expect(toFormDocument({ id: 1, submitLabel: '' }).buttons).toBeUndefined()
		expect(toFormDocument({ id: 1 }).buttons).toBeUndefined()
	})

	it('coerces the top-level multistep and pollEnabled flags to strict booleans', () => {
		expect(toFormDocument({ id: 1 })).toMatchObject({ multistep: false, pollEnabled: false })
		expect(toFormDocument({ id: 1, multistep: true, pollEnabled: true })).toMatchObject({
			multistep: true,
			pollEnabled: true,
		})
		expect(toFormDocument({ id: 1, multistep: null, pollEnabled: null })).toMatchObject({
			multistep: false,
			pollEnabled: false,
		})
	})

	describe('consent statements', () => {
		it('applies consentStatements carried on the form doc when no option is passed', () => {
			const doc = toFormDocument({
				id: 1,
				fields: [{ blockType: 'consent', name: 'terms', source: 's1' }],
				consentStatements: {
					terms: { statement: { root: {} }, link: { label: 'Privacy', url: '/p' } },
				},
			})
			const consent = doc.fields.find((f) => f.name === 'terms') as Record<string, unknown>
			expect(consent.statement).toEqual({ root: {} })
			expect(consent.link).toEqual({ label: 'Privacy', url: '/p' })
		})

		it('prefers an explicit consentStatements option over the doc-carried one', () => {
			const doc = toFormDocument(
				{
					id: 1,
					fields: [{ blockType: 'consent', name: 'terms', source: 's1' }],
					consentStatements: { terms: { statement: 'DOC' } },
				},
				{ consentStatements: { terms: { statement: 'OPT' } } }
			)
			const consent = doc.fields.find((f) => f.name === 'terms') as Record<string, unknown>
			expect(consent.statement).toBe('OPT')
		})
	})

	describe('redirect reference', () => {
		it('passes a populated (Doc) redirect reference through unchanged', () => {
			const reference = { relationTo: 'pages', value: { id: 'p1', slug: 'about' } }
			const doc = toFormDocument({ id: 1, response: { type: 'redirect', redirect: { reference } } })
			expect((doc.response?.redirect as { reference?: unknown })?.reference).toEqual(reference)
		})

		it('fills redirect.url from resolveRedirect only when url is empty and type is redirect', () => {
			const resolveRedirect = (ref: { value: unknown }) =>
				`/x/${(ref.value as { slug: string }).slug}`
			const filled = toFormDocument(
				{
					id: 1,
					response: {
						type: 'redirect',
						redirect: { reference: { relationTo: 'pages', value: { slug: 'about' } } },
					},
				},
				{ resolveRedirect }
			)
			expect((filled.response?.redirect as { url?: string })?.url).toBe('/x/about')

			const kept = toFormDocument(
				{
					id: 1,
					response: {
						type: 'redirect',
						redirect: { url: '/set', reference: { relationTo: 'pages', value: { slug: 'about' } } },
					},
				},
				{ resolveRedirect }
			)
			expect((kept.response?.redirect as { url?: string })?.url).toBe('/set')
		})
	})

	// The asymmetry is a contract, not an accident: response is a host-extensible visitor-facing
	// group cast wholesale; buttons and poll are allowlists so host extras and server-only members
	// cannot leak to the client.
	describe('unknown-key preservation', () => {
		it('preserves unknown keys on response', () => {
			const response = { type: 'message', message: 'Thanks', tone: 'celebratory' }
			const doc = toFormDocument({ id: 1, response })
			expect(doc.response).toBe(response)
			expect((doc.response as Record<string, unknown>)?.tone).toBe('celebratory')
		})

		it('drops unknown top-level keys from buttons, keeping only the three labels', () => {
			const doc = toFormDocument({
				id: 1,
				submitLabel: 'Send',
				submitIcon: 'arrow-right',
			} as Parameters<typeof toFormDocument>[0])
			expect(doc.buttons).toEqual({ submitLabel: 'Send' })
		})

		it('drops unknown keys on poll, including anything a host stored in sourceConfig', () => {
			const doc = toFormDocument({
				id: 1,
				poll: {
					resultsField: 'colour',
					optionSource: 'catalogue',
					sourceConfig: { apiKey: 'secret', tenantId: 'acme' },
					internalNote: 'not for visitors',
				} as Parameters<typeof toFormDocument>[0]['poll'],
			})
			expect(doc.poll).toEqual({
				resultsVisibility: undefined,
				closesAt: undefined,
			})
			expect(Object.keys(doc.poll ?? {})).toEqual(['resultsVisibility', 'closesAt'])
		})

		it('passes poll.allowChange through only when enabled', () => {
			const on = toFormDocument({ id: 1, poll: { allowChange: true } })
			expect(on.poll?.allowChange).toBe(true)
			const off = toFormDocument({ id: 1, poll: { resultsField: 'colour' } })
			expect('allowChange' in (off.poll ?? {})).toBe(false)
			const explicitOff = toFormDocument({ id: 1, poll: { allowChange: false } })
			expect('allowChange' in (explicitOff.poll ?? {})).toBe(false)
		})

		it('drops unknown keys on poll.outcome, keeping winningValues alone', () => {
			const doc = toFormDocument({
				id: 1,
				poll: {
					outcome: { winningValues: ['ada'], resolvedAt: '2026-07-01T00:00:00.000Z' },
				} as Parameters<typeof toFormDocument>[0]['poll'],
			})
			expect(doc.poll?.outcome).toEqual({ winningValues: ['ada'] })
		})
	})

	it('passes a nameless bare row through with its block row id intact', () => {
		const doc = toFormDocument({
			id: 1,
			fields: [
				{ blockType: 'text', name: 'first' },
				{ blockType: 'message', id: 'row-note', content: { root: { children: [] } } },
			],
		})
		expect(doc.fields).toHaveLength(2)
		expect(doc.fields[1]).toMatchObject({ blockType: 'message', id: 'row-note' })
		expect(doc.fields[1]?.name).toBeUndefined()
	})

	it('passes through poll lifecycle settings and drops the server-only resultsField', () => {
		const poll = {
			resultsVisibility: 'afterClose',
			closesAt: '2026-07-01T00:00:00.000Z',
			resultsField: 'colour',
		}
		const doc = toFormDocument({ id: 1, fields: [], poll })
		expect(doc.poll).toEqual({
			resultsVisibility: 'afterClose',
			closesAt: '2026-07-01T00:00:00.000Z',
		})
	})

	it('coerces a null poll and null poll members to undefined', () => {
		expect(toFormDocument({ id: 1, poll: null }).poll).toBeUndefined()
		const doc = toFormDocument({
			id: 1,
			poll: { resultsVisibility: null, closesAt: null },
		})
		expect(doc.poll).toEqual({
			resultsVisibility: undefined,
			closesAt: undefined,
		})
	})

	it('passes through the outcome winningValues only, dropping empty or null entries', () => {
		const withOutcome = toFormDocument({
			id: 1,
			poll: { outcome: { winningValues: ['ada'] } },
		})
		expect(withOutcome.poll?.outcome).toEqual({ winningValues: ['ada'] })
		const tie = toFormDocument({
			id: 1,
			poll: { outcome: { winningValues: ['ada', 'grace'] } },
		})
		expect(tie.poll?.outcome).toEqual({ winningValues: ['ada', 'grace'] })
		expect(
			toFormDocument({
				id: 1,
				poll: { outcome: { winningValues: ['ada', '', null] } },
			}).poll?.outcome
		).toEqual({ winningValues: ['ada'] })
		expect(
			toFormDocument({ id: 1, poll: { outcome: { winningValues: [] } } }).poll?.outcome
		).toBeUndefined()
		expect(
			toFormDocument({ id: 1, poll: { outcome: { winningValues: null } } }).poll?.outcome
		).toBeUndefined()
		expect(toFormDocument({ id: 1, poll: {} }).poll?.outcome).toBeUndefined()
	})

	it('injects pollOptions into the resultsField-named instance', () => {
		const fields = [
			{ blockType: 'text', name: 'nickname' },
			{ blockType: 'select', name: 'winner', options: [{ label: 'Old', value: 'old' }] },
		]
		const pollOptions = [
			{ label: 'Ada', value: 'ada' },
			{ label: 'Grace', value: 'grace' },
		]
		const doc = toFormDocument({ id: 1, fields, poll: { resultsField: 'winner' } }, { pollOptions })
		expect(doc.fields[1]?.options).toEqual(pollOptions)
		expect(doc.fields[0]).toBe(fields[0])
		expect(fields[1]?.options).toEqual([{ label: 'Old', value: 'old' }])
	})

	it('keeps no-arg behavior identical: authored options untouched without pollOptions', () => {
		const fields = [
			{ blockType: 'select', name: 'winner', options: [{ label: 'Old', value: 'old' }] },
		]
		const doc = toFormDocument({ id: 1, fields, poll: { resultsField: 'winner' } })
		expect(doc.fields[0]?.options).toEqual([{ label: 'Old', value: 'old' }])
	})

	it('accepts a generated form type whose blocks are interfaces, with no cast', () => {
		const form: GeneratedForm = {
			id: 'f1',
			fields: [{ blockType: 'text', name: 'email' }, { blockType: 'message' }],
			createdAt: '',
			updatedAt: '',
		}
		expectTypeOf(toFormDocument).toBeCallableWith(form)
		expect(toFormDocument(form).fields).toHaveLength(2)
	})
})
