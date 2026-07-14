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
})
