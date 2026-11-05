import { describe, expect, it } from 'vitest'
import { memoryAdapter } from '../testing/memoryAdapter'
import { KEYED, type OptionPath, optionPaths } from '../testing/optionPaths'
import { type AnalyticsPluginOptions, resolveOptions } from './options'
import { isRecord } from './values'

/** The name a host-keyed map's placeholder stands for in a probe. */
const KEY_FOR: Readonly<Record<string, string>> = {
	collections: 'pages',
	'widgets.overrides': 'analytics-metric',
}

const concrete = (path: string): string =>
	Object.entries(KEYED).reduce(
		(at, [map, placeholder]) => at.replace(`${map}.${placeholder}`, `${map}.${KEY_FOR[map]}`),
		path
	)

const scoped = { scope: { resolve: () => null, member: () => true } }

/** What an option needs beside it to be read at all, by the path it sits under. */
const CONTEXT: ReadonlyArray<readonly [prefix: string, options: Record<string, unknown>]> = [
	['scope', scoped],
	['access.crossScope', scoped],
	['capture.slots.tenant', scoped],
	['capture.paths.tenant', scoped],
	['collections.<slug>', { collections: { pages: { pathField: 'slug' } } }],
	['collections.<slug>.scopeField', scoped],
	['goals.collection.scopeField', scoped],
	['providers.collection.scopeField', scoped],
	['providers.hosts', { providers: { collection: true } }],
	['jobs.tasks.sync', { sync: true }],
	['jobs.tasks.warm', { cache: { warm: true } }],
]

const under = (path: string, prefix: string): boolean =>
	path === prefix || path.startsWith(`${prefix}.`)

const merged = (into: Record<string, unknown>, from: Record<string, unknown>): void => {
	for (const [key, value] of Object.entries(from)) {
		const held = into[key]
		if (isRecord(held) && isRecord(value) && !Array.isArray(value)) {
			merged(held, value)
		} else {
			into[key] = isRecord(value) && !Array.isArray(value) ? { ...value } : value
		}
	}
}

/** `options` with `value` at the dotted `path`, every object on the way made or copied. */
const setAt = (options: Record<string, unknown>, path: string, value: unknown): void => {
	const steps = path.split('.')
	let at = options
	for (const step of steps.slice(0, -1)) {
		const next = at[step]
		const copy = isRecord(next) && !Array.isArray(next) ? { ...next } : {}
		at[step] = copy
		at = copy
	}
	at[steps.at(-1) ?? ''] = value
}

/** A config that boots, plus what `path` needs beside it, with `value` written at `path`. */
const probed = (path: string, value: unknown): AnalyticsPluginOptions => {
	// Without a gate a scoped install whose tenant slot can fill is refused, whatever else it says.
	const options: Record<string, unknown> = { adapters: [memoryAdapter()], capture: { gate: 'off' } }
	for (const [prefix, extra] of CONTEXT) {
		if (under(path, prefix)) {
			merged(options, extra)
		}
	}
	if (path !== '') {
		setAt(options, concrete(path), value)
	}
	return options as AnalyticsPluginOptions
}

/** The first of these a path's type does not take: a number written as a string comes first. */
const PROBES = ['300', 42, 'not-an-option', true] as const

const probeOf = (option: OptionPath): (typeof PROBES)[number] | undefined =>
	PROBES.find((probe) => !option.accepts(probe))

const refusal = (options: AnalyticsPluginOptions): string => {
	try {
		resolveOptions(options)
	} catch (err) {
		return err instanceof Error ? err.message : String(err)
	}
	return 'booted'
}

describe('every option is checked at boot', () => {
	const paths = optionPaths()

	it('boots each context the probes below are written into', () => {
		for (const [prefix] of CONTEXT) {
			expect(refusal(probed(prefix, undefined)), prefix).toBe('booted')
		}
	})

	it('has a value for each option path that its type refuses', () => {
		expect(paths.filter((option) => probeOf(option) === undefined).map((o) => o.path)).toEqual([])
	})

	// A path missing here boots with a value of the wrong type: give it a check naming the path.
	it('refuses a value of the wrong type at every option path, naming the path', () => {
		const unchecked = paths.flatMap((option) => {
			const probe = probeOf(option)
			const message = refusal(probed(option.path, probe))
			return message.includes(concrete(option.path))
				? []
				: [`${option.path} = ${JSON.stringify(probe)}: ${message}`]
		})
		expect(unchecked).toEqual([])
	})

	it('refuses a key it does not know in each of its own option objects, naming both', () => {
		const objects = [
			'',
			...paths.filter((option) => option.closed).map((option) => option.path),
			...Object.entries(KEYED).map(([map, placeholder]) => `${map}.${placeholder}`),
		]
		const open = objects.flatMap((path) => {
			const key = path === '' ? 'notAnOption' : `${path}.notAnOption`
			const options = probed(path, undefined)
			setAt(options as Record<string, unknown>, concrete(key), 1)
			if (path.startsWith('collections.')) {
				setAt(options as Record<string, unknown>, 'collections.pages.pathField', 'slug')
			}
			const message = refusal(options)
			return message.includes('notAnOption') && message.includes(concrete(path))
				? []
				: [`${concrete(key)}: ${message}`]
		})
		expect(open).toEqual([])
	})

	it('names the numbers it refuses, ranges included', () => {
		expect(refusal(probed('cache.ttl.aggregate', '300'))).toBe(
			'analytics: cache.ttl.aggregate must be a whole number of seconds, 0 or more, got "300"'
		)
		expect(refusal(probed('cache.ttl.realtime', -1))).toMatch(/cache\.ttl\.realtime .* got -1/)
		expect(refusal(probed('cache.ttl.realtime', 1.5))).toMatch(/cache\.ttl\.realtime/)
		expect(refusal(probed('cache.ttl.aggregate', 0))).toBe('booted')
		expect(refusal(probed('capture.proxy.timeoutMs', 0))).toMatch(
			/capture\.proxy\.timeoutMs must be a whole number of 1 or more, got 0/
		)
		expect(refusal(probed('capture.proxy.maxBodyBytes', Number.POSITIVE_INFINITY))).toMatch(
			/capture\.proxy\.maxBodyBytes/
		)
	})

	it('names a widget, an adapter and a goal it cannot read by their place in the list', () => {
		expect(refusal(probed('widgets.disabled', ['analytics-metrics']))).toMatch(
			/widgets\.disabled names "analytics-metrics", which is no widget of this install/
		)
		expect(refusal(probed('widgets.register', [{ slug: 'mine', component: '' }]))).toMatch(
			/widgets\.register\[0\]\.component must be a component path/
		)
		// An ignored retired key would register the widget on sources it was meant to skip.
		const requiring = (requires: Record<string, unknown>) =>
			refusal(
				probed('widgets.register', [{ slug: 'mine', component: '/w#W', label: 'Mine', requires }])
			)
		expect(requiring({ perPageQuery: true })).toMatch(
			/widgets\.register\[0\]\.requires\.perPageQuery is gone since 1\.0\.0-beta\.12; use path: true/
		)
		expect(requiring({ filterOperators: ['contains'] })).toMatch(
			/requires\.filterOperators is gone .* filters: \[\{ dimension: 'page', operator: 'contains' \}\]/
		)
		expect(requiring({ realtme: true })).toMatch(/requires\.realtme is not an option/)
		expect(requiring({ metrics: ['pageviews'], path: true, perItemQuery: true })).toBe('booted')
		expect(
			refusal(
				probed('widgets', {
					register: [{ slug: 'mine', component: '/w#W', label: 'Mine' }],
					disabled: ['mine'],
				})
			)
		).toBe('booted')
		expect(refusal({ adapters: [memoryAdapter(), memoryAdapter()] })).toMatch(
			/adapters lists two adapters with the id "memory"/
		)
		expect(refusal(probed('adapters', [memoryAdapter(), { id: 'half' }]))).toMatch(
			/adapters\[1\] must be an adapter/
		)
		expect(refusal(probed('goals.defaults', ['signup']))).toMatch(
			/goals\.defaults\[0\] must be a goal/
		)
		expect(refusal(probed('translations', { de: { viewTitle: 'Statistik' } }))).toMatch(
			/translations\.de\["viewTitle"\] is not one of the plugin's translation keys/
		)
		expect(refusal(probed('translations', { de: { 'analytics:viewTitle': 'Statistik' } }))).toBe(
			'booted'
		)
	})
})
