import type { Config, Widget, WidgetWidth } from 'payload'
import { describe, expect, it } from 'vitest'
import { native } from '../native/nativeAdapter'
import { BREAKDOWN_SPECS } from './breakdownTypes'
import { analyticsDefaultWidgets } from './defaults'
import { registerWidgets } from './registerWidgets'
import { resolveGoalRowLimit } from './types'

/** Every built-in widget, gate open, which is the catalogue the default layout draws from. */
const registered = (): Widget[] => {
	const config = {} as Config
	registerWidgets(config, {
		adapters: [native()],
		multiProvider: false,
		// Open-world: the layout is a starting point for any install, not for this adapter's
		// capabilities, and Payload skips an instance whose widget a gate left unregistered.
		providersEnabled: true,
		disabled: [],
		register: [],
	})
	return config.admin?.dashboard?.widgets ?? []
}

/** Narrowest to widest, as Payload orders the widths an instance may take. */
const WIDTHS: WidgetWidth[] = ['x-small', 'small', 'medium', 'large', 'x-large', 'full']

describe('analyticsDefaultWidgets', () => {
	it('places every built-in widget', () => {
		const placed = new Set(analyticsDefaultWidgets().map((instance) => instance.widgetSlug))
		expect(placed).toEqual(new Set(registered().map((widget) => widget.slug)))
	})

	it('opens with the headline numbers and ends with the breakdowns', () => {
		const slugs = analyticsDefaultWidgets().map((instance) => instance.widgetSlug)
		expect(slugs.slice(0, 5)).toEqual([
			'analytics-metric',
			'analytics-metric',
			'analytics-trend',
			'analytics-goals',
			'analytics-realtime',
		])
		expect(slugs.slice(5).every((slug) => slug.startsWith('analytics-breakdown-'))).toBe(true)
	})

	it('gives no breakdown card two places in the layout', () => {
		const breakdowns = analyticsDefaultWidgets()
			.map((instance) => instance.widgetSlug)
			.filter((slug) => slug.startsWith('analytics-breakdown-'))
		expect(breakdowns).toHaveLength(new Set(breakdowns).size)
	})

	it('opens each breakdown on the metric its widget defaults to', () => {
		const expected = new Map(
			BREAKDOWN_SPECS.map((spec) => [spec.slug, spec.preferredDefault ?? 'pageviews'])
		)
		const metrics = analyticsDefaultWidgets()
			.filter((instance) => expected.has(instance.widgetSlug))
			.map((instance) => [instance.widgetSlug, instance.data?.metric])
		expect(metrics).toEqual([...expected.entries()])
	})

	it('opens the goals table on a row count its select offers', () => {
		const goals = analyticsDefaultWidgets().find(
			(instance) => instance.widgetSlug === 'analytics-goals'
		)
		expect(resolveGoalRowLimit(goals?.data?.limit)).toBe(Number(goals?.data?.limit))
	})

	it('sizes every instance within the widths its widget allows', () => {
		const widgets = new Map(registered().map((widget) => [widget.slug, widget]))
		for (const instance of analyticsDefaultWidgets()) {
			const widget = widgets.get(instance.widgetSlug)
			const at = WIDTHS.indexOf(instance.width)
			const min = widget?.minWidth ? WIDTHS.indexOf(widget.minWidth) : 0
			const max = widget?.maxWidth ? WIDTHS.indexOf(widget.maxWidth) : WIDTHS.length - 1
			expect({ slug: instance.widgetSlug, within: at >= min && at <= max }).toEqual({
				slug: instance.widgetSlug,
				within: true,
			})
		}
	})
})
