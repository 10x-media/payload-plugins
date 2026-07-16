import { describe, expect, it } from 'vitest'
import { toFormDocument } from './toFormDocument'

describe('toFormDocument', () => {
	it('coerces a null response and display to undefined', () => {
		const doc = toFormDocument({ id: 1, fields: [], response: null, display: null })
		expect(doc.response).toBeUndefined()
		expect(doc.display).toBeUndefined()
	})

	it('passes through display settings', () => {
		const doc = toFormDocument({
			id: 1,
			fields: [],
			display: { showTitle: true, title: 'Contact us', intro: { root: {} } },
		})
		expect(doc.display).toEqual({ showTitle: true, title: 'Contact us', intro: { root: {} } })
	})

	it('defaults fields to an empty array and leaves display/response undefined when omitted', () => {
		const doc = toFormDocument({ id: 1 })
		expect(doc.fields).toEqual([])
		expect(doc.display).toBeUndefined()
		expect(doc.response).toBeUndefined()
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
