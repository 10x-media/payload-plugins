import { describe, expect, it } from 'vitest'
import type { IconMeta } from '../../../types'
import { emitImportsModule, emitManifestModule, GENERATED_HEADER } from './emit'

const icons: IconMeta[] = [
	{ name: 'alpha', tags: ['first'], categories: ['letters'] },
	{ name: 'beta', tags: [], categories: [] },
]

describe('codegen emitters', () => {
	it('emits a manifest module with header, sorted categories, and parseable data', () => {
		const output = emitManifestModule(icons, ['letters'])
		expect(output.startsWith(GENERATED_HEADER)).toBe(true)
		const json = output.slice(output.indexOf('= ') + 2)
		expect(JSON.parse(json)).toEqual({ icons, categories: ['letters'] })
	})

	it('emits an imports module with named-export picks and bare default imports', () => {
		const output = emitImportsModule(icons, (icon) =>
			icon.name === 'alpha'
				? { module: 'fake-icons', exportName: 'AlphaIcon' }
				: { module: `fake-icons/lib/${icon.name}.mjs` }
		)
		expect(output.startsWith(GENERATED_HEADER)).toBe(true)
		expect(output).toContain(
			`'alpha': () => import('fake-icons').then((m) => ({ default: m.AlphaIcon })),`
		)
		expect(output).toContain(`'beta': () => import('fake-icons/lib/beta.mjs'),`)
		expect(output).toContain('export const iconImports')
	})
})
