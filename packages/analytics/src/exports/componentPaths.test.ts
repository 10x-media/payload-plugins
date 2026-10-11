import { fileURLToPath } from 'node:url'
import type { Config } from 'payload'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { analyticsStat, analyticsStatRow, analyticsTab } from '../fields/factories'
import { analyticsLinkFields } from '../goals/linkFields'
import { trackGoalAction } from '../goals/trackGoalAction'
import { analytics } from '../index'
import { native } from '../native/nativeAdapter'
import { memoryAdapter } from '../testing/memoryAdapter'
import * as client from './client'
import * as rsc from './rsc'

/**
 * Every component path the plugin and its field factories register, frozen for 1.x: a host's
 * import map names these, so a component that moves keeps its old path as a re-export.
 */
const REGISTERED = [
	'@10x-media/analytics/client#AnalyticsNavLink',
	'@10x-media/analytics/client#DateRangeField',
	'@10x-media/analytics/client#GoalAmountField',
	'@10x-media/analytics/rsc#AnalyticsBreakdownWidget',
	'@10x-media/analytics/rsc#AnalyticsGoalsWidget',
	'@10x-media/analytics/rsc#AnalyticsMetricWidget',
	'@10x-media/analytics/rsc#AnalyticsPanelField',
	'@10x-media/analytics/rsc#AnalyticsRealtimeWidget',
	'@10x-media/analytics/rsc#AnalyticsStatField',
	'@10x-media/analytics/rsc#AnalyticsTrendWidget',
	'@10x-media/analytics/rsc#AnalyticsView',
	'@10x-media/analytics/rsc#FilterDimensionSelectFieldServer',
	'@10x-media/analytics/rsc#FilterOperatorSelectFieldServer',
	'@10x-media/analytics/rsc#FilterValueFieldServer',
	'@10x-media/analytics/rsc#GoalSelectFieldServer',
	'@10x-media/analytics/rsc#MetricSelectFieldServer',
	'@10x-media/analytics/rsc#SourceSelectFieldServer',
]

/**
 * Client picker paths the server wrappers replaced. A host whose import map still names them keeps
 * a working picker keyed by the cookie scope.
 */
const RETIRED = [
	'@10x-media/analytics/client#FilterDimensionSelectField',
	'@10x-media/analytics/client#FilterOperatorSelectField',
	'@10x-media/analytics/client#GoalSelectField',
	'@10x-media/analytics/client#MetricSelectField',
	'@10x-media/analytics/client#SourceSelectField',
]

const COMPONENT_PATH = /^@10x-media\/analytics\/[a-z]+#\w+$/

/** Every plugin component path anywhere in `value`, the way an import map generator walks a config. */
const componentPaths = (value: unknown, found = new Set<string>(), seen = new Set<object>()) => {
	if (typeof value === 'string') {
		if (COMPONENT_PATH.test(value)) {
			found.add(value)
		}
	} else if (typeof value === 'object' && value !== null && !seen.has(value)) {
		seen.add(value)
		for (const entry of Object.values(value)) {
			componentPaths(entry, found, seen)
		}
	}
	return found
}

const ENTRIES: Record<string, Record<string, unknown>> = { client, rsc }

const exported = (path: string): unknown => {
	const [specifier = '', name = ''] = path.split('#')
	const entry = ENTRIES[specifier.replace('@10x-media/analytics/', '')]
	return entry?.[name]
}

const hostConfig = () =>
	({
		collections: [
			{
				slug: 'pages',
				fields: [
					{ type: 'tabs', tabs: [analyticsTab()] },
					analyticsStat({ metric: 'pageviews' }),
					analyticsStatRow(),
					...analyticsLinkFields({ value: true }),
				],
			},
		],
	}) as unknown as Config

describe('stable component paths', () => {
	it('registers exactly the frozen set, from the plugin and every field factory', async () => {
		const config = await analytics({
			adapters: [native(), memoryAdapter()],
			capture: { gate: 'off' },
			revenue: { currency: 'EUR' },
		})(hostConfig())
		const found = componentPaths([config, trackGoalAction()])
		expect([...found].sort()).toEqual(REGISTERED)
	})

	it('exports a component under every registered path', () => {
		for (const path of REGISTERED) {
			expect(typeof exported(path), path).toBe('function')
		}
	})

	it('keeps the retired picker paths exported for import maps generated before the wrappers', () => {
		for (const path of RETIRED) {
			expect(typeof exported(path), path).toBe('function')
		}
	})

	it('tags each retired picker path @deprecated, naming the server path that replaces it', () => {
		const file = fileURLToPath(new URL('./client.ts', import.meta.url))
		const program = ts.createProgram([file], {
			strict: true,
			noEmit: true,
			skipLibCheck: true,
			target: ts.ScriptTarget.ES2022,
			module: ts.ModuleKind.ESNext,
			moduleResolution: ts.ModuleResolutionKind.Bundler,
			jsx: ts.JsxEmit.ReactJSX,
			customConditions: ['development'],
		})
		const checker = program.getTypeChecker()
		const source = program.getSourceFile(file)
		const entry = source && checker.getSymbolAtLocation(source)
		const exports = entry ? checker.getExportsOfModule(entry) : []
		for (const path of RETIRED) {
			const name = path.split('#')[1] ?? ''
			const symbol = exports.find((each) => each.getName() === name)
			const declared = symbol && checker.getAliasedSymbol(symbol)
			const deprecated = declared?.getJsDocTags(checker).find((tag) => tag.name === 'deprecated')
			const text = ts.displayPartsToString(deprecated?.text)
			expect(text, path).toContain(`@10x-media/analytics/rsc#${name}Server`)
			expect(REGISTERED, path).toContain(`@10x-media/analytics/rsc#${name}Server`)
		}
	})

	it('puts only the host components in admin.dependencies', async () => {
		const config = await analytics({
			adapters: [memoryAdapter()],
			view: { Component: '/components/View#View' },
			countryFlags: { Component: '/components/Flag#Flag' },
		})(hostConfig())
		const dependencies = Object.values(config.admin?.dependencies ?? {})
		expect(dependencies.map((dependency) => dependency.path).sort()).toEqual([
			'/components/Flag#Flag',
			'/components/View#View',
		])
	})
})
