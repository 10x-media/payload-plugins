import { jobs } from '@10x-media/jobs'
import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { webhooks } from '@10x-media/webhooks'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { AUTOMATIONS_CUSTOM_KEY, automations } from '../../src/index'

describeForDb('plugin family interop', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		// Pass the three plugins in deliberately the "wrong" array order to prove
		// buildConfig sorts by `order`, not array position.
		booted = await bootPayload({
			plugin: automations({ triggers: ['collection-change', 'schedule'] }),
			configOverrides: { plugins: [webhooks({}), jobs({})] },
			db,
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('registers all three plugins by slug', () => {
		const slugs = (booted.payload.config.plugins ?? []).map((p) => p.slug)
		expect(slugs).toContain('@10x-media/jobs')
		expect(slugs).toContain('@10x-media/webhooks')
		expect(slugs).toContain('@10x-media/automations')
	})

	it('lets webhooks contribute its trigger into automations (ran before automations)', () => {
		const custom = booted.payload.config.custom?.[AUTOMATIONS_CUSTOM_KEY] as
			| { triggers: string[] }
			| undefined
		expect(custom).toBeDefined()
		expect(custom?.triggers).toContain('collection-change')
		expect(custom?.triggers).toContain('schedule')
		expect(custom?.triggers).toContain('webhook')
	})
})

describeForDb('automations without webhooks', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: automations({ triggers: ['collection-change'] }),
			db,
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('does not contribute the webhook trigger when webhooks is absent', () => {
		const custom = booted.payload.config.custom?.[AUTOMATIONS_CUSTOM_KEY] as
			| { triggers: string[] }
			| undefined
		expect(custom?.triggers).toEqual(['collection-change'])
	})
})
