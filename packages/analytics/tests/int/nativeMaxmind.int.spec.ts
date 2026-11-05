import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { handleEndpoints } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import type { MaxmindSdk } from '../../src/core/sdks'
import { analytics } from '../../src/index'
import { native } from '../../src/native/nativeAdapter'
import { INGEST_HOST } from './ingestRequest'
import { storedHits } from './nativeHelpers'

const DB_PATH = '/geo/GeoLite2-City.mmdb'
/** The address the trusted proxy appended, which is the visitor's. */
const VISITOR = '203.0.113.7'
/** What the visitor wrote into the chain themselves, which no lookup may use. */
const WRITTEN = '198.51.100.9'

/** Stands in for the `maxmind` package: its reader knows two addresses and nothing else. */
const fakeMaxmind = (opened: string[]): MaxmindSdk => {
	const countries: Record<string, string> = { [VISITOR]: 'NZ', [WRITTEN]: 'KP' }
	const open = async (path: string) => {
		opened.push(path)
		return {
			get: (ip: string) => {
				const country = countries[ip]
				return country ? { country: { iso_code: country } } : null
			},
		}
	}
	return { open: open as unknown as MaxmindSdk['open'] }
}

describeForDb('native geo through sdks.maxmind', {}, (db) => {
	const opened: string[] = []
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: analytics({
				adapters: [native({ geoDbPath: DB_PATH })],
				capture: { gate: 'off' },
				trustedProxyHops: 1,
				sdks: { maxmind: fakeMaxmind(opened) },
			}),
			db,
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it(`stores the country the handed-in reader answers for the visitor's address on ${db}`, async () => {
		const res = await handleEndpoints({
			config: booted.payload.config,
			payloadInstanceCacheKey: booted.cacheKey,
			request: new Request('http://localhost:3000/api/_x/e', {
				method: 'POST',
				body: JSON.stringify({ type: 'pageview', path: '/maxmind' }),
				headers: {
					'content-type': 'application/json',
					'user-agent': 'UA',
					host: INGEST_HOST,
					'x-forwarded-for': `${WRITTEN}, ${VISITOR}`,
				},
			}),
		})
		expect(res.status).toBe(202)

		const docs = await storedHits(booted.payload, { path: { equals: '/maxmind' } })
		expect(docs).toHaveLength(1)
		expect(docs[0]?.country).toBe('NZ')
		expect(opened).toEqual([DB_PATH])
	})
})
