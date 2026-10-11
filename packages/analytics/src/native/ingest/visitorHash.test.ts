import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { dailyVisitorId, VISITOR_ID_LENGTH } from './visitorHash'

describe('dailyVisitorId', () => {
	const visitor = { ip: '1.2.3.4', ua: 'UA', site: 's', salt: 'salt-1' }

	it('is 96 bits of the keyed hash of address, agent and site, as 16 base64url characters', () => {
		const id = dailyVisitorId(visitor)
		expect(id).toHaveLength(VISITOR_ID_LENGTH)
		expect(id).toMatch(/^[A-Za-z0-9_-]{16}$/)
		const full = createHmac('sha256', 'salt-1').update('1.2.3.4|UA|s').digest()
		expect(id).toBe(full.toString('base64url').slice(0, 16))
	})

	it('is the same for one visitor on one site in one day, and rotates with the salt', () => {
		expect(dailyVisitorId(visitor)).toBe(dailyVisitorId({ ...visitor }))
		expect(dailyVisitorId({ ...visitor, salt: 'salt-2' })).not.toBe(dailyVisitorId(visitor))
		expect(dailyVisitorId({ ...visitor, site: 't' })).not.toBe(dailyVisitorId(visitor))
	})

	it('holds nothing of the address it was made from', () => {
		expect(dailyVisitorId(visitor)).not.toContain('1.2.3.4')
	})
})
