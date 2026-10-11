import { describe, expect, it } from 'vitest'
import type { AnalyticsAdapter } from '../core/contract'
import { memoryAdapter } from '../testing/memoryAdapter'
import { combineRegistries } from './resolver'

const stub = (id: string): AnalyticsAdapter => ({ ...memoryAdapter(), id })

/** A provider document's adapter, tagged with the document id the resolver records. */
const doc = (adapter: AnalyticsAdapter, docId = `doc-${adapter.id}`) => ({ adapter, docId })

describe('combineRegistries', () => {
	it('returns the base registry when there are no runtime adapters', () => {
		const a = stub('a')
		const registry = combineRegistries({ adapters: [a] }, []).registry
		expect(registry.all()).toEqual([a])
	})

	it('appends runtime adapters after the base', () => {
		const base = stub('memory')
		const instance = stub('posthog:doc1')
		const registry = combineRegistries({ adapters: [base] }, [doc(instance)]).registry
		expect(registry.all()).toEqual([base, instance])
		expect(registry.get('memory')).toBe(base)
		expect(registry.get('posthog:doc1')).toBe(instance)
	})

	// The scope's own document names the source, so it takes the base's place rather than being
	// added beside it: one entry, the base's position, and the document's label.
	it('an extra whose id collides with a base adapter takes its place', () => {
		const base = { ...stub('posthog'), label: 'Platform PostHog' }
		const runtime = { ...stub('posthog'), label: 'Beta site database' }
		const registry = combineRegistries({ adapters: [base] }, [doc(runtime)]).registry
		expect(registry.get('posthog')).toBe(runtime)
		expect(registry.all()).toEqual([runtime])
	})

	it('two instance adapters of one provider type both join the registry', () => {
		const base = stub('memory')
		const a = stub('posthog:a')
		const b = stub('posthog:b')
		const registry = combineRegistries({ adapters: [base] }, [doc(a), doc(b)]).registry
		expect(registry.get('posthog:a')).toBe(a)
		expect(registry.get('posthog:b')).toBe(b)
		expect(registry.all()).toEqual([base, a, b])
	})

	// A `native` document configures no credentials: it grants the config native adapter, which
	// is already in the registry, so the grant is the only thing that changes.
	it('records a grant for an extra whose id collides with a config adapter', () => {
		const base = stub('native')
		const { registry, grants } = combineRegistries({ adapters: [base] }, [doc(base, 'native-doc')])
		expect(registry.all()).toEqual([base])
		expect(grants.get('native')).toBe('native-doc')
	})

	it('records one grant per runtime adapter and none for an ungranted config adapter', () => {
		const { grants } = combineRegistries({ adapters: [stub('memory')] }, [
			doc(stub('plausible:1'), 'd1'),
		])
		expect(grants.get('plausible:1')).toBe('d1')
		expect(grants.has('memory')).toBe(false)
	})

	it('the default stays the config default regardless of extras', () => {
		const registry = combineRegistries({ adapters: [stub('a'), stub('b')], defaultId: 'b' }, [
			doc(stub('posthog:doc1')),
		]).registry
		expect(registry.default().id).toBe('b')
	})

	it('with no explicit default the first config adapter stays default', () => {
		const registry = combineRegistries({ adapters: [stub('a'), stub('b')] }, [
			doc(stub('posthog:doc1')),
		]).registry
		expect(registry.default().id).toBe('a')
	})
})
