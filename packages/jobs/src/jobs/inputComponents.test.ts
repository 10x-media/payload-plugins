import { describe, expect, it } from 'vitest'

import type { JobInputComponents } from './inputComponents'
import { collectInputDependencies, renderedKey, resolveInputComponent } from './inputComponents'

const components: JobInputComponents = {
	'*': '/components/GenericInput#GenericInput',
	importAthletes: '/components/ImportAthletesInput#ImportAthletesInput',
	noop: false,
}

describe('resolveInputComponent', () => {
	it('returns undefined when nothing is configured', () => {
		expect(resolveInputComponent(undefined, 'importAthletes')).toBeUndefined()
	})

	it('resolves the exact slug over the wildcard', () => {
		expect(resolveInputComponent(components, 'importAthletes')).toBe(
			'/components/ImportAthletesInput#ImportAthletesInput'
		)
	})

	it('falls back to the wildcard for an unlisted slug', () => {
		expect(resolveInputComponent(components, 'sleep')).toBe('/components/GenericInput#GenericInput')
	})

	it('lets false opt a slug out of the wildcard', () => {
		expect(resolveInputComponent(components, 'noop')).toBeUndefined()
	})

	it('has no wildcard unless one is declared', () => {
		expect(resolveInputComponent({ sleep: '/a#A' }, 'other')).toBeUndefined()
	})
})

describe('collectInputDependencies', () => {
	it('registers every configured path under a namespaced key, skipping false', () => {
		expect(collectInputDependencies(components)).toEqual({
			'@10x-media/jobs:input:*': {
				path: '/components/GenericInput#GenericInput',
				type: 'component',
			},
			'@10x-media/jobs:input:importAthletes': {
				path: '/components/ImportAthletesInput#ImportAthletesInput',
				type: 'component',
			},
		})
	})

	it('folds an object component with exportName into the path', () => {
		expect(
			collectInputDependencies({ sleep: { exportName: 'SleepForm', path: '/components/Sleep' } })
		).toEqual({
			'@10x-media/jobs:input:sleep': { path: '/components/Sleep#SleepForm', type: 'component' },
		})
	})

	it('is empty without components', () => {
		expect(collectInputDependencies(undefined)).toEqual({})
	})
})

describe('renderedKey', () => {
	it('keeps a task and a workflow sharing a slug apart', () => {
		expect(renderedKey('task', 'sync')).not.toBe(renderedKey('workflow', 'sync'))
	})
})
