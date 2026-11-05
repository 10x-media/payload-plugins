import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { analytics, type CustomWidgetDef } from '../../src/index'
import { native } from '../../src/native/nativeAdapter'

const slugs = (booted: BootedPayload): string[] =>
	((booted.payload.config.admin?.dashboard?.widgets ?? []) as Array<{ slug: string }>).map(
		(w) => w.slug
	)

describeForDb('custom widget registration', {}, (db) => {
	let supported: BootedPayload
	let gatedOut: BootedPayload

	const bootRegistering = (widget: CustomWidgetDef): Promise<BootedPayload> =>
		bootPayload({
			plugin: analytics({
				adapters: [native()],
				capture: { gate: 'off' },
				widgets: { register: [widget] },
			}),
			db,
		})

	beforeAll(async () => {
		supported = await bootRegistering({
			slug: 'myapp-sources',
			component: '@10x-media/analytics/rsc#AnalyticsBreakdownWidget',
			label: 'My sources',
			requires: { dimensions: ['source'] },
		})
		gatedOut = await bootRegistering({
			slug: 'myapp-visits',
			component: '@/x#default',
			label: 'Visits',
			requires: { metrics: ['visits'] },
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
		expect(slugs(gatedOut)).not.toContain('myapp-visits')
	})
})
