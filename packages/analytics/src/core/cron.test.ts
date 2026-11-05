import { describe, expect, it } from 'vitest'
import { cronIntervalMs, isCronPattern } from './cron'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

describe('isCronPattern', () => {
	it('takes five fields, six with seconds first, and the nicknames', () => {
		for (const pattern of [
			'*/15 * * * *',
			'0 */6 * * *',
			'0 3 * * MON-FRI',
			'30 */15 * * * *',
			'0 0 1,15 * ?',
			'@hourly',
			' @Daily ',
		]) {
			expect(isCronPattern(pattern), pattern).toBe(true)
		}
	})

	it('refuses what is no pattern at all', () => {
		for (const value of [
			'',
			'   ',
			'15 minutes',
			'* * * *',
			'* * * * * * *',
			'*/15 * * * $',
			15,
			null,
		]) {
			expect(isCronPattern(value), String(value)).toBe(false)
		}
	})
})

describe('cronIntervalMs', () => {
	it('reads the cadence of every minute, every n minutes or hours, hourly and daily', () => {
		expect(cronIntervalMs('* * * * *')).toBe(MINUTE)
		expect(cronIntervalMs('*/15 * * * *')).toBe(15 * MINUTE)
		expect(cronIntervalMs('0 */15 * * * *')).toBe(15 * MINUTE)
		expect(cronIntervalMs('7 * * * *')).toBe(HOUR)
		expect(cronIntervalMs('0 */6 * * *')).toBe(6 * HOUR)
		expect(cronIntervalMs('30 2 * * *')).toBe(24 * HOUR)
		expect(cronIntervalMs('@hourly')).toBe(HOUR)
		expect(cronIntervalMs('@weekly')).toBe(7 * 24 * HOUR)
	})

	it('reads nothing off a pattern whose runs are not evenly apart', () => {
		for (const pattern of [
			'*/7 * * * *',
			'0 */5 * * *',
			'0,30 * * * *',
			'0 3 * * 1',
			'* 3 * * *',
			'*/5 * * * * *',
		]) {
			expect(cronIntervalMs(pattern), pattern).toBeNull()
		}
	})
})
