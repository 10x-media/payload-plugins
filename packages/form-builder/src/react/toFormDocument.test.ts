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
})
