import { describe, expect, it } from 'vitest'
import { toFormDocument } from './toFormDocument'

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

	it('passes buttons through wholesale so host-added keys survive to the client', () => {
		const buttons = { submitLabel: 'Send', submitIcon: 'arrow-right' }
		const doc = toFormDocument({ id: 1, fields: [], buttons })
		expect(doc.buttons).toBe(buttons)
		expect(doc.buttons?.submitIcon).toBe('arrow-right')
	})

	it('coerces a null or omitted buttons to undefined', () => {
		expect(toFormDocument({ id: 1, buttons: null }).buttons).toBeUndefined()
		expect(toFormDocument({ id: 1 }).buttons).toBeUndefined()
	})

	// The asymmetry is a contract, not an accident: response and buttons are host-extensible
	// visitor-facing groups, poll is an allowlist so server-only members cannot leak to the client.
	describe('unknown-key preservation', () => {
		it('preserves unknown keys on response', () => {
			const response = { type: 'message', message: 'Thanks', tone: 'celebratory' }
			const doc = toFormDocument({ id: 1, response })
			expect(doc.response).toBe(response)
			expect((doc.response as Record<string, unknown>)?.tone).toBe('celebratory')
		})

		it('preserves unknown keys on buttons', () => {
			const buttons = { submitLabel: 'Send', submitIcon: 'arrow-right' }
			const doc = toFormDocument({ id: 1, buttons })
			expect(doc.buttons).toBe(buttons)
			expect((doc.buttons as Record<string, unknown>)?.submitIcon).toBe('arrow-right')
		})

		it('drops unknown keys on poll, including anything a host stored in sourceConfig', () => {
			const doc = toFormDocument({
				id: 1,
				poll: {
					enabled: true,
					resultsField: 'colour',
					optionSource: 'catalogue',
					sourceConfig: { apiKey: 'secret', tenantId: 'acme' },
					internalNote: 'not for visitors',
				} as Parameters<typeof toFormDocument>[0]['poll'],
			})
			expect(doc.poll).toEqual({
				enabled: true,
				resultsVisibility: undefined,
				closesAt: undefined,
			})
			expect(Object.keys(doc.poll ?? {})).toEqual(['enabled', 'resultsVisibility', 'closesAt'])
		})

		it('drops unknown keys on poll.outcome, keeping winningValue alone', () => {
			const doc = toFormDocument({
				id: 1,
				poll: {
					enabled: true,
					outcome: { winningValue: 'ada', resolvedAt: '2026-07-01T00:00:00.000Z' },
				} as Parameters<typeof toFormDocument>[0]['poll'],
			})
			expect(doc.poll?.outcome).toEqual({ winningValue: 'ada' })
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
			enabled: true,
			resultsVisibility: 'afterClose',
			closesAt: '2026-07-01T00:00:00.000Z',
			resultsField: 'colour',
		}
		const doc = toFormDocument({ id: 1, fields: [], poll })
		expect(doc.poll).toEqual({
			enabled: true,
			resultsVisibility: 'afterClose',
			closesAt: '2026-07-01T00:00:00.000Z',
		})
	})

	it('coerces a null poll and null poll members to undefined', () => {
		expect(toFormDocument({ id: 1, poll: null }).poll).toBeUndefined()
		const doc = toFormDocument({
			id: 1,
			poll: { enabled: null, resultsVisibility: null, closesAt: null },
		})
		expect(doc.poll).toEqual({
			enabled: undefined,
			resultsVisibility: undefined,
			closesAt: undefined,
		})
	})

	it('passes through the outcome winningValue only, dropping empty or null values', () => {
		const withOutcome = toFormDocument({
			id: 1,
			poll: { enabled: true, outcome: { winningValue: 'ada' } },
		})
		expect(withOutcome.poll?.outcome).toEqual({ winningValue: 'ada' })
		expect(
			toFormDocument({ id: 1, poll: { enabled: true, outcome: { winningValue: null } } }).poll
				?.outcome
		).toBeUndefined()
		expect(
			toFormDocument({ id: 1, poll: { enabled: true, outcome: { winningValue: '' } } }).poll
				?.outcome
		).toBeUndefined()
		expect(toFormDocument({ id: 1, poll: { enabled: true } }).poll?.outcome).toBeUndefined()
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
		const doc = toFormDocument(
			{ id: 1, fields, poll: { enabled: true, resultsField: 'winner' } },
			{ pollOptions }
		)
		expect(doc.fields[1]?.options).toEqual(pollOptions)
		expect(doc.fields[0]).toBe(fields[0])
		expect(fields[1]?.options).toEqual([{ label: 'Old', value: 'old' }])
	})

	it('keeps no-arg behavior identical: authored options untouched without pollOptions', () => {
		const fields = [
			{ blockType: 'select', name: 'winner', options: [{ label: 'Old', value: 'old' }] },
		]
		const doc = toFormDocument({ id: 1, fields, poll: { enabled: true, resultsField: 'winner' } })
		expect(doc.fields[0]?.options).toEqual([{ label: 'Old', value: 'old' }])
	})
})
