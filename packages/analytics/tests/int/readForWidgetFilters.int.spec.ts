import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { analytics } from '../../src/index'
import { native } from '../../src/native/nativeAdapter'
import { readForWidget } from '../../src/widgets/readForWidget'
import { nativeOf, pageviewHit } from './nativeHelpers'
import { readerRequest } from './readerRequest'

describeForDb('readForWidget filter pass-through', {}, (db) => {
	let booted: BootedPayload
	beforeAll(async () => {
		booted = await bootPayload({
			plugin: analytics({ adapters: [native()], capture: { gate: 'off' } }),
			db,
		})
	})
	afterAll(async () => {
		await booted.stop()
	})
	const req = () => readerRequest(booted.payload)

	const recordEvent = (path: string, timestamp: string) =>
		nativeOf(booted.payload).store.append([
			pageviewHit({ ts: new Date(timestamp), path, v: `v-${path}` }),
		])

	it('narrows totals to the matching events against the native adapter', async () => {
		await recordEvent('/a', '2026-06-01T12:00:00.000Z')
		await recordEvent('/b', '2026-06-01T12:00:00.000Z')
		const result = await readForWidget({
			req: req(),
			metrics: ['pageviews'],
			timeframe: 'last30days',
			now: new Date('2026-06-02T00:00:00.000Z'),
			filters: [{ dimension: 'page', operator: 'eq', value: '/a' }],
		})
		expect(result.status).toBe('ok')
		expect(result.metrics.pageviews).toBe(1)
	})
})
