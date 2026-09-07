import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { analytics } from '../../src/index'
import { native } from '../../src/native/nativeAdapter'

const slugs = (booted: BootedPayload): string[] =>
	((booted.payload.config.admin?.dashboard?.widgets ?? []) as Array<{ slug: string }>).map(
		(w) => w.slug
	)

describeForDb('custom widget registration', { dbs: ['mongo'] }, (db) => {
	let supported: BootedPayload
	let gatedOut: BootedPayload
	beforeAll(async () => {
		supported = await bootPayload({
			plugin: analytics({
				adapters: [native()],
				widgets: {
					register: [
						{
							slug: 'myapp-sources',
							component: '@10x-media/analytics/rsc#AnalyticsBreakdownWidget',
							label: 'My sources',
							requires: { dimensions: ['source'] },
						},
					],
				},
			}),
			db,
		})
		gatedOut = await bootPayload({
			plugin: analytics({
				adapters: [native()],
				widgets: {
					register: [
						{
							slug: 'myapp-bounce',
							component: '@/x#default',
							label: 'Bounce rate',
							requires: { metrics: ['bounceRate'] },
						},
					],
				},
			}),
			db,
		})
	})
	afterAll(async () => {
		await supported?.stop()
		await gatedOut?.stop()
	})

	it('registers a custom widget whose requires the native adapter satisfies', () => {
		expect(slugs(supported)).toContain('myapp-sources')
	})
	it('does not register a custom widget gated out by capabilities', () => {
		expect(slugs(gatedOut)).not.toContain('myapp-bounce')
	})
})
