import { describe, expect, it } from 'vitest'
import { jobsListURL } from './jobsListURL'

describe('jobsListURL', () => {
	it('returns the bare list URL without a status', () => {
		expect(jobsListURL('/admin')).toBe('/admin/collections/payload-jobs')
	})

	it('serializes the status where-clause into query params', () => {
		const url = jobsListURL('/admin', 'running')
		expect(url).toContain('/admin/collections/payload-jobs?')
		expect(decodeURIComponent(url)).toContain('where[processing][equals]=true')
	})

	it('pins scheduled clauses to the provided timestamp', () => {
		const now = Date.parse('2026-07-08T12:00:00Z')
		const url = decodeURIComponent(jobsListURL('/admin', 'scheduled', now))
		expect(url).toContain('2026-07-08T12:00:00.000Z')
	})
})
