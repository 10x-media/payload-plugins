import type { Payload, PayloadRequest, WidgetServerProps } from 'payload'
import { createElement, type ReactNode } from 'react'
import { renderToReadableStream } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AnalyticsAdapter, AnalyticsResult } from '../core/contract'
import { createRegistry } from '../core/registry'
import { type AnalyticsRuntime, getRuntime, setRuntime } from '../plugin/runtime'
import { memoryAdapter } from '../testing/memoryAdapter'
import AnalyticsBreakdownWidget from './AnalyticsBreakdownWidget'
import AnalyticsGoalsWidget from './AnalyticsGoalsWidget'
import AnalyticsMetricWidget from './AnalyticsMetricWidget'
import AnalyticsRealtimeWidget from './AnalyticsRealtimeWidget'
import AnalyticsTrendWidget from './AnalyticsTrendWidget'

/** A source whose every read waits until the test lets it answer. */
const slowSource = () => {
	let release: (() => void) | undefined
	const answered = new Promise<void>((resolve) => {
		release = resolve
	})
	const answer = async (): Promise<AnalyticsResult> => {
		await answered
		return {
			rows: [],
			totals: { pageviews: 4321 },
			meta: { provider: 'slow', fetchedAt: '2026-06-30T00:00:00.000Z' },
		}
	}
	const adapter: AnalyticsAdapter = {
		id: 'slow',
		label: 'Slow',
		capabilities: { ...memoryAdapter().capabilities, metrics: new Set(['pageviews']) },
		isConfigured: () => true,
		query: answer,
		realtime: answer,
	}
	return { adapter, release: () => release?.() }
}

const requestFor = (adapter: AnalyticsAdapter): PayloadRequest => {
	const payload = {
		logger: { warn: () => {} },
		config: { routes: { admin: '/admin', api: '/api' }, serverURL: '' },
	} as unknown as Payload
	setRuntime(payload, {
		registry: createRegistry([adapter]),
		configAdapterIds: new Set([adapter.id]),
		bindings: {},
		readAccess: () => true,
		engine: { read: (a: AnalyticsAdapter, query: unknown) => a.query(query as never, {}) },
		ttl: {},
		comparison: false,
	} as unknown as AnalyticsRuntime)
	return {
		payload,
		i18n: { t: (key: string) => key, language: 'en' },
	} as unknown as PayloadRequest
}

const decoder = new TextDecoder()

/**
 * Streams a widget the way the dashboard places it, inside the page around it: React flushes a
 * fallback early only when something outside the boundary is part of the first flush.
 */
const streamOnDashboard = (widget: ReactNode) =>
	renderToReadableStream(createElement('div', { className: 'grid' }, widget))

const readAll = async (reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> => {
	let text = ''
	for (;;) {
		const { done, value } = await reader.read()
		if (done) {
			return text
		}
		text += decoder.decode(value)
	}
}

const widgets: Array<[string, (props: WidgetServerProps) => ReactNode, string]> = [
	['metric', AnalyticsMetricWidget, 'analytics-metric'],
	['trend', AnalyticsTrendWidget, 'analytics-trend'],
	['breakdown', AnalyticsBreakdownWidget, 'analytics-breakdown-pages'],
	['goals', AnalyticsGoalsWidget, 'analytics-goals'],
	['realtime', AnalyticsRealtimeWidget, 'analytics-realtime'],
]

describe('dashboard widgets while their source is slow', () => {
	it.each(
		widgets
	)('the %s widget streams its titled frame first, before the read answers', async (_name, Widget, widgetSlug) => {
		const { adapter, release } = slowSource()
		const req = requestFor(adapter)
		const element = Widget({
			req,
			widgetSlug,
			widgetData: { title: 'Slow card' },
		} as unknown as WidgetServerProps)
		// A synchronous answer: the dashboard places it without waiting on anything.
		expect(element).not.toBeInstanceOf(Promise)
		const stream = await streamOnDashboard(element)
		const reader = stream.getReader()
		const shell = decoder.decode((await reader.read()).value)
		expect(shell).toContain('analytics-widget--loading')
		expect(shell).toContain('Slow card')
		expect(shell).toContain('aria-busy="true"')
		release()
		const rest = await readAll(reader)
		expect(rest).not.toBe('')
		expect(`${shell}${rest}`).toContain('Slow card')
	})

	// A loading card as tall as the finished one keeps a dashboard row still when reads answer.
	it.each([
		{
			kind: 'metric',
			Widget: AnalyticsMetricWidget,
			slug: 'analytics-metric',
			value: true,
			body: false,
		},
		{
			kind: 'trend',
			Widget: AnalyticsTrendWidget,
			slug: 'analytics-trend',
			value: true,
			body: true,
		},
		{
			kind: 'realtime',
			Widget: AnalyticsRealtimeWidget,
			slug: 'analytics-realtime',
			value: true,
			body: true,
		},
		{
			kind: 'breakdown',
			Widget: AnalyticsBreakdownWidget,
			slug: 'analytics-breakdown-pages',
			value: false,
			body: true,
		},
		{
			kind: 'goals',
			Widget: AnalyticsGoalsWidget,
			slug: 'analytics-goals',
			value: false,
			body: true,
		},
	] as const)('the $kind widget loads in the shape of its finished card', async ({
		kind,
		Widget,
		slug: widgetSlug,
		value,
		body,
	}) => {
		const { adapter, release } = slowSource()
		const stream = await streamOnDashboard(
			Widget({
				req: requestFor(adapter),
				widgetSlug,
				widgetData: { title: 'Slow card', limit: 8 },
				view: { path: '/analytics', defaultRange: 'last30days', defaultMetric: 'pageviews' },
			} as unknown as WidgetServerProps)
		)
		const reader = stream.getReader()
		const shell = decoder.decode((await reader.read()).value)
		expect(shell).toContain(`analytics-widget__loading--${kind}`)
		expect(shell.includes('analytics-widget__shimmer-value')).toBe(value)
		expect(shell.includes('analytics-widget__shimmer"')).toBe(body)
		// The footer link's line is held, invisibly, so the finished card's footer adds none.
		expect(shell).toContain('analytics-widget__link analytics-widget__link--placeholder')
		if (kind === 'breakdown') {
			expect(shell).toContain('--analytics-rows:8')
		}
		release()
		await readAll(reader)
	})

	it('holds no footer line where the view is off, and so the card has no link', async () => {
		const { adapter, release } = slowSource()
		const stream = await streamOnDashboard(
			AnalyticsMetricWidget({
				req: requestFor(adapter),
				widgetSlug: 'analytics-metric',
				widgetData: { title: 'Slow card' },
				view: false,
			} as unknown as WidgetServerProps)
		)
		const reader = stream.getReader()
		const shell = decoder.decode((await reader.read()).value)
		expect(shell).not.toContain('analytics-widget__link--placeholder')
		release()
		await readAll(reader)
	})

	it('streams the number in once the read answers', async () => {
		const { adapter, release } = slowSource()
		const stream = await streamOnDashboard(
			AnalyticsMetricWidget({
				req: requestFor(adapter),
				widgetData: { metric: 'pageviews', timeframe: 'last7days' },
			} as unknown as WidgetServerProps)
		)
		const reader = stream.getReader()
		const shell = decoder.decode((await reader.read()).value)
		expect(shell).not.toContain('4,321')
		release()
		expect(await readAll(reader)).toContain('4,321')
	})
})

/** A source counting daily visitors, as native does, that answers once let. */
const summingSource = () => {
	const slow = slowSource()
	const adapter: AnalyticsAdapter = {
		...slow.adapter,
		capabilities: {
			...slow.adapter.capabilities,
			metrics: new Set(['visitors']),
			semantics: { visitors: 'sumOfDaily', sessions: 'inactivity30m' },
		},
		query: async (query, ctx) => {
			const answered = await slow.adapter.query(query, ctx)
			return {
				...answered,
				totals: { visitors: 12 },
				meta: { ...answered.meta, visitorsAre: 'sumOfDaily' },
			}
		},
	}
	return { adapter, release: slow.release }
}

const headingOf = (html: string): string => /<h2[^>]*>([^<]*)<\/h2>/.exec(html)?.[1] ?? ''

describe('the visitors title while the read runs', () => {
	// Unforecast, the frame reads "Visitors" and the card "Daily visitors, summed" a moment later.
	it.each([
		['metric', AnalyticsMetricWidget],
		['trend', AnalyticsTrendWidget],
	] as const)('the %s widget names summed daily visitors before the number arrives', async (_name, Widget) => {
		const { adapter, release } = summingSource()
		const stream = await streamOnDashboard(
			Widget({
				req: requestFor(adapter),
				widgetData: { metric: 'visitors', timeframe: 'last30days' },
			} as unknown as WidgetServerProps)
		)
		const reader = stream.getReader()
		const shell = decoder.decode((await reader.read()).value)
		expect(headingOf(shell)).toBe('analytics:metricVisitorsSummed')
		release()
		const rest = await readAll(reader)
		expect(headingOf(rest)).toBe('analytics:metricVisitorsSummed')
	})

	it('names one day of visitors plainly, as the read will', async () => {
		const { adapter, release } = summingSource()
		const stream = await streamOnDashboard(
			AnalyticsMetricWidget({
				req: requestFor(adapter),
				widgetData: { metric: 'visitors', timeframe: 'today' },
			} as unknown as WidgetServerProps)
		)
		const reader = stream.getReader()
		const shell = decoder.decode((await reader.read()).value)
		expect(headingOf(shell)).toBe('analytics:metricVisitors')
		release()
		await readAll(reader)
	})

	// Which source a scope reads is only known once the read resolves it: the title waits too.
	it('shimmers the title where only the read knows its source', async () => {
		const { adapter, release } = summingSource()
		const req = requestFor(adapter)
		const runtime = getRuntime(req.payload)
		if (!runtime) {
			throw new Error('runtime missing')
		}
		setRuntime(req.payload, {
			...runtime,
			resolveRegistry: async () => ({ registry: createRegistry([adapter]), grants: new Map() }),
		})
		const stream = await streamOnDashboard(
			AnalyticsMetricWidget({
				req,
				widgetData: { metric: 'visitors', timeframe: 'last30days' },
			} as unknown as WidgetServerProps)
		)
		const reader = stream.getReader()
		const shell = decoder.decode((await reader.read()).value)
		expect(shell).toContain('analytics-widget__title analytics-sr-only')
		release()
		await readAll(reader)
	})
})
