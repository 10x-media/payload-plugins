import type { Config } from 'payload'
import { describe, expect, it } from 'vitest'
import { addComponentDependency, FLAG_DEPENDENCY, importMapPath } from './adminDependencies'

describe('importMapPath', () => {
	it('keys a component the way the import map looks it up, path#export', () => {
		expect(importMapPath('/components/Flag#Flag')).toBe('/components/Flag#Flag')
		expect(importMapPath('/components/Flag')).toBe('/components/Flag#default')
		expect(importMapPath({ path: '/components/Flag', exportName: 'Flag' })).toBe(
			'/components/Flag#Flag'
		)
	})
})

describe('addComponentDependency', () => {
	it("lists the component in admin.dependencies beside the host's own", () => {
		const config = {
			admin: { dependencies: { host: { type: 'function', path: '/x#y' } } },
		} as unknown as Config
		addComponentDependency(config, FLAG_DEPENDENCY, {
			path: '/components/Flag',
			exportName: 'Flag',
			clientProps: { size: 16 },
		})
		expect(config.admin?.dependencies).toEqual({
			host: { type: 'function', path: '/x#y' },
			[FLAG_DEPENDENCY]: { type: 'component', path: '/components/Flag#Flag' },
		})
	})
})
