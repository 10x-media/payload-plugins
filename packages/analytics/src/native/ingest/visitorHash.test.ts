import { describe, expect, it } from 'vitest'
import { dailyVisitorHash, deriveSessionId } from './visitorHash'

describe('dailyVisitorHash', () => {
	it('is deterministic for the same inputs and salt', () => {
		const a = dailyVisitorHash({ ip: '1.2.3.4', ua: 'UA', site: 's', salt: 'salt-1' })
		const b = dailyVisitorHash({ ip: '1.2.3.4', ua: 'UA', site: 's', salt: 'salt-1' })
		expect(a).toBe(b)
		expect(a).toMatch(/^[a-f0-9]{64}$/)
	})
	it('changes when the daily salt rotates', () => {
		const a = dailyVisitorHash({ ip: '1.2.3.4', ua: 'UA', site: 's', salt: 'salt-1' })
		const b = dailyVisitorHash({ ip: '1.2.3.4', ua: 'UA', site: 's', salt: 'salt-2' })
		expect(a).not.toBe(b)
	})
	it('does not contain the raw ip', () => {
		expect(dailyVisitorHash({ ip: '1.2.3.4', ua: 'UA', site: 's', salt: 'salt-1' })).not.toContain(
			'1.2.3.4'
		)
	})
})

describe('deriveSessionId', () => {
	it('is stable for a visitor within the same hour bucket', () => {
		expect(deriveSessionId('visitor-abc', '2026-01-01T10:15')).toBe(
			deriveSessionId('visitor-abc', '2026-01-01T10:15')
		)
	})
})
