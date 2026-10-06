import { describe, expect, it } from 'vitest'

import type { JobLogEntryComponents } from './logSlotComponents'
import { collectLogDependencies, resolveSlotComponent } from './logSlotComponents'

const components: JobLogEntryComponents = {
	'*': { error: '/components/PrettyError#PrettyError' },
	sendEmail: {
		input: '/components/EmailInput#EmailInput',
		output: '/components/EmailOutput#EmailOutput',
	},
}

describe('resolveSlotComponent', () => {
	it('returns undefined when no components are configured', () => {
		expect(resolveSlotComponent(undefined, 'sendEmail', 'input')).toBeUndefined()
	})

	it('resolves the exact task slug', () => {
		expect(resolveSlotComponent(components, 'sendEmail', 'output')).toBe(
			'/components/EmailOutput#EmailOutput'
		)
	})

	it('falls back to the wildcard slot by slot', () => {
		expect(resolveSlotComponent(components, 'sendEmail', 'error')).toBe(
			'/components/PrettyError#PrettyError'
		)
	})

	it('leaves a slot unset when neither the slug nor the wildcard defines it', () => {
		expect(
			resolveSlotComponent({ sendEmail: { output: '/a#A' } }, 'sendEmail', 'input')
		).toBeUndefined()
	})

	it('prefers the exact slug over the wildcard for the same slot', () => {
		const map: JobLogEntryComponents = {
			'*': { output: '/wild#Wild' },
			sendEmail: { output: '/exact#Exact' },
		}
		expect(resolveSlotComponent(map, 'sendEmail', 'output')).toBe('/exact#Exact')
	})

	it('falls back to the wildcard for an unknown or missing task slug', () => {
		expect(resolveSlotComponent(components, 'syncCrm', 'error')).toBe(
			'/components/PrettyError#PrettyError'
		)
		expect(resolveSlotComponent(components, undefined, 'error')).toBe(
			'/components/PrettyError#PrettyError'
		)
	})

	it('treats an explicit false as an opt-out from the wildcard', () => {
		const map: JobLogEntryComponents = {
			'*': { output: '/wild#Wild' },
			sendEmail: { output: false },
		}
		expect(resolveSlotComponent(map, 'sendEmail', 'output')).toBeUndefined()
		expect(resolveSlotComponent(map, 'syncCrm', 'output')).toBe('/wild#Wild')
	})

	it('keys the reserved inline slug like any other task', () => {
		const map: JobLogEntryComponents = { inline: { input: '/inline#Inline' } }
		expect(resolveSlotComponent(map, 'inline', 'input')).toBe('/inline#Inline')
	})
})

describe('collectLogDependencies', () => {
	it('returns nothing when no components are configured', () => {
		expect(collectLogDependencies(undefined)).toEqual({})
		expect(collectLogDependencies({})).toEqual({})
	})

	it('registers one dependency per configured slot under a namespaced key', () => {
		expect(collectLogDependencies(components)).toEqual({
			'@10x-media/jobs:log:*:error': {
				path: '/components/PrettyError#PrettyError',
				type: 'component',
			},
			'@10x-media/jobs:log:sendEmail:input': {
				path: '/components/EmailInput#EmailInput',
				type: 'component',
			},
			'@10x-media/jobs:log:sendEmail:output': {
				path: '/components/EmailOutput#EmailOutput',
				type: 'component',
			},
		})
	})

	it('folds exportName into the path so the import map key matches at runtime', () => {
		expect(
			collectLogDependencies({
				sendEmail: { output: { exportName: 'Out', path: '/components/Out' } },
			})
		).toEqual({
			'@10x-media/jobs:log:sendEmail:output': { path: '/components/Out#Out', type: 'component' },
		})
	})

	it('carries clientProps and serverProps through', () => {
		expect(
			collectLogDependencies({
				sendEmail: {
					output: {
						clientProps: { compact: true },
						path: '/components/Out#Out',
						serverProps: { depth: 2 },
					},
				},
			})
		).toEqual({
			'@10x-media/jobs:log:sendEmail:output': {
				clientProps: { compact: true },
				path: '/components/Out#Out',
				serverProps: { depth: 2 },
				type: 'component',
			},
		})
	})

	it('skips slots that are unset or explicitly opted out', () => {
		expect(collectLogDependencies({ sendEmail: { output: undefined } })).toEqual({})
		expect(collectLogDependencies({ sendEmail: { output: false } })).toEqual({})
	})
})
