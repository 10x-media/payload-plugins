import { describe, expect, it } from 'vitest'
import {
	createdAtOf,
	type DocumentRead,
	isEmptyDocumentRead,
	isNewDocumentAnalytics,
} from './emptyState'

const RANGE = {
	start: new Date('2026-06-01T00:00:00.000Z'),
	end: new Date('2026-06-30T23:59:59.999Z'),
}
const BEFORE = '2026-03-14T09:00:00.000Z'
const INSIDE = '2026-06-20T09:00:00.000Z'

const zeros = (over: Partial<DocumentRead> = {}): DocumentRead => ({
	status: 'ok',
	metrics: { pageviews: 0, visitors: 0 },
	supportedMetrics: ['pageviews', 'visitors'],
	dateRange: RANGE,
	...over,
})

describe('isNewDocumentAnalytics', () => {
	it('is new when no path resolved (an unsaved or unbound document), timestamps or not', () => {
		const read: DocumentRead = { status: 'no-path', metrics: {}, supportedMetrics: [] }
		expect(isNewDocumentAnalytics(read, undefined)).toBe(true)
		expect(isNewDocumentAnalytics({ ...read, dateRange: RANGE }, BEFORE)).toBe(true)
	})

	it('is new when nothing was counted and the document was created inside the range', () => {
		expect(isNewDocumentAnalytics(zeros(), INSIDE)).toBe(true)
		expect(isNewDocumentAnalytics(zeros(), RANGE.start.toISOString())).toBe(true)
	})

	it('is not new when the document existed before the range, however empty the range was', () => {
		expect(isNewDocumentAnalytics(zeros(), BEFORE)).toBe(false)
		expect(isEmptyDocumentRead(zeros())).toBe(true)
	})

	it('is not new when the collection keeps no timestamps, since nothing says the document is new', () => {
		expect(isNewDocumentAnalytics(zeros(), undefined)).toBe(false)
	})

	it('is not new when the read carries no window to compare against', () => {
		expect(isNewDocumentAnalytics(zeros({ dateRange: undefined }), INSIDE)).toBe(false)
	})

	it("reads the endpoint's window, its bounds ISO strings, like the server's", () => {
		const fromJson = zeros({ dateRange: { start: RANGE.start.toISOString() } })
		expect(isNewDocumentAnalytics(fromJson, INSIDE)).toBe(true)
		expect(isNewDocumentAnalytics(fromJson, BEFORE)).toBe(false)
	})

	it('is not new once any metric has data, even for a document created inside the range', () => {
		expect(isNewDocumentAnalytics(zeros({ metrics: { pageviews: 3, visitors: 0 } }), INSIDE)).toBe(
			false
		)
	})

	it('counts a missing total or an average with nothing to average as nothing counted', () => {
		const read = zeros({
			metrics: { avgDuration: null },
			supportedMetrics: ['pageviews', 'avgDuration'],
		})
		expect(isEmptyDocumentRead(read)).toBe(true)
		expect(isNewDocumentAnalytics(read, INSIDE)).toBe(true)
	})

	it('is never new for a configuration or reader state (that is a message, not a new page)', () => {
		for (const status of ['not-bound', 'not-configured', 'unavailable', 'no-access'] as const) {
			const read = zeros({ status, metrics: {}, supportedMetrics: [] })
			expect(isNewDocumentAnalytics(read, INSIDE)).toBe(false)
			expect(isEmptyDocumentRead(read)).toBe(false)
		}
	})
})

describe('createdAtOf', () => {
	it('reads the timestamp Payload keeps, as a string or a Date', () => {
		expect(createdAtOf({ createdAt: INSIDE })).toBe(INSIDE)
		expect(createdAtOf({ createdAt: new Date(INSIDE) })).toBe(INSIDE)
	})

	it('is undefined without timestamps, before the first save, or for a value that is no date', () => {
		expect(createdAtOf({ slug: 'pricing' })).toBeUndefined()
		expect(createdAtOf({ createdAt: null })).toBeUndefined()
		expect(createdAtOf({ createdAt: 'yesterday-ish' })).toBeUndefined()
		expect(createdAtOf({ createdAt: 1_750_000_000_000 })).toBeUndefined()
	})
})
