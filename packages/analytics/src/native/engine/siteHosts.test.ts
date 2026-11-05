import { describe, expect, it } from 'vitest'
import type { CalendarDay } from '../../timeframe/calendar'
import { createSiteHosts, SITE_HOSTS_REFRESH_MS } from './siteHosts'

const NOON = new Date('2026-10-07T12:00:00.000Z')

const rig = (stored: () => string[] | Promise<string[]>) => {
	const clock = { at: NOON.getTime() }
	const asked: Array<[string, CalendarDay]> = []
	const warnings: string[] = []
	const hosts = createSiteHosts({
		store: {
			hostnames: async (scope, since) => {
				asked.push([scope, since])
				return stored()
			},
		},
		now: () => new Date(clock.at),
		warn: (message) => warnings.push(message),
	})
	return { hosts, clock, asked, warnings }
}

describe('the hostnames a scope records hits under', () => {
	it('reads them from its daily totals of the last 30 days, bare, once per ten minutes', async () => {
		const ready = rig(() => ['www.Shop.example', 'site.example'])
		expect([...(await ready.hosts.of('a'))]).toEqual(['shop.example', 'site.example'])
		await ready.hosts.of('a')
		expect(ready.asked).toEqual([['a', 20260907]])
		ready.clock.at += SITE_HOSTS_REFRESH_MS + 1
		await ready.hosts.of('a')
		expect(ready.asked).toHaveLength(2)
	})

	it('adds the hostnames this process just stored a hit under, per scope', async () => {
		const ready = rig(() => [])
		ready.hosts.saw('a', 'www.blog.example')
		expect([...(await ready.hosts.of('a'))]).toEqual(['blog.example'])
		expect([...(await ready.hosts.of('b'))]).toEqual([])
	})

	it('asks once for concurrent callers, and keeps what it has when the read fails', async () => {
		let fail = false
		const ready = rig(() => {
			if (fail) {
				throw new Error('database away')
			}
			return ['shop.example']
		})
		await Promise.all([ready.hosts.of('a'), ready.hosts.of('a'), ready.hosts.of('a')])
		expect(ready.asked).toHaveLength(1)
		fail = true
		ready.clock.at += SITE_HOSTS_REFRESH_MS + 1
		expect([...(await ready.hosts.of('a'))]).toEqual(['shop.example'])
		expect(ready.warnings).toHaveLength(1)
	})
})
