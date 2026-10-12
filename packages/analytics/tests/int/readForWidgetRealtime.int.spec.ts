import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { analytics } from '../../src/index'
import { native } from '../../src/native/nativeAdapter'
import { readForWidgetRealtime } from '../../src/widgets/readForWidgetRealtime'
import { nativeOf, pageviewHit } from './nativeHelpers'
import { readerRequest } from './readerRequest'

describeForDb('readForWidgetRealtime', {}, (db) => {
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

	it('reads the active count and a minute series for the window', async () => {
		const now = new Date('2026-06-24T15:00:00.000Z')
		await nativeOf(booted.payload).store.append([
			pageviewHit({ ts: new Date(now.getTime() - 60_000), v: 'v1' }),
		])
		const result = await readForWidgetRealtime({
			req: req(),
			metric: 'visitors',
			windowMinutes: 30,
			now,
		})
		expect(result.status).toBe('ok')
		expect(result.activeNow).toBe(1)
		expect(result.series.length).toBe(31)
	})
})
