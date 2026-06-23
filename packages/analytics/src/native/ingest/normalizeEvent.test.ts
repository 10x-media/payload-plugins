import { describe, expect, it } from 'vitest'
import { noopResolver, platformHeaderResolver } from '../geo/geoResolver'
import { normalizeEvent } from './normalizeEvent'

const headers = (h: Record<string, string>) => new Headers(h)

describe('normalizeEvent', () => {
	it('builds a stored event with geo, hash, and no ip', async () => {
		const ev = await normalizeEvent({
			raw: { type: 'pageview', path: '/pricing', hostname: 'site.com', durationMs: 1200 },
			headers: headers({
				'x-vercel-ip-country': 'US',
				'x-forwarded-for': '9.9.9.9',
				'user-agent': 'UA',
			}),
			geoResolver: platformHeaderResolver,
			salt: 'salt-1',
			now: new Date('2026-01-01T10:15:00Z'),
		})
		expect(ev.type).toBe('pageview')
		expect(ev.path).toBe('/pricing')
		expect(ev.country).toBe('US')
		expect(ev.durationMs).toBe(1200)
		expect(ev.visitorHash).toMatch(/^[a-f0-9]{64}$/)
		expect(ev.sessionId).toHaveLength(32)
		expect(JSON.stringify(ev)).not.toContain('9.9.9.9')
		expect(ev.timestamp.toISOString()).toBe('2026-01-01T10:15:00.000Z')
	})
	it('honors a noop geo resolver', async () => {
		const ev = await normalizeEvent({
			raw: { type: 'pageview', path: '/', hostname: 'site.com' },
			headers: headers({ 'x-vercel-ip-country': 'US', 'user-agent': 'UA' }),
			geoResolver: noopResolver,
			salt: 's',
			now: new Date('2026-01-01T00:00:00Z'),
		})
		expect(ev.country).toBeUndefined()
	})

	it('derives device from the user-agent header and source from the referrer', async () => {
		const event = await normalizeEvent({
			raw: {
				type: 'pageview',
				path: '/p',
				hostname: 'example.com',
				referrer: 'https://www.google.com/',
			},
			headers: new Headers({
				'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile/15E148',
			}),
			geoResolver: async () => ({}),
			salt: 'salt',
			now: new Date('2026-06-01T00:00:00.000Z'),
		})
		expect(event.device).toBe('mobile')
		expect(event.source).toBe('google.com')
	})
})
