import { describe, expect, it } from 'vitest'
import type { IconNode } from '../../../../types'
import { loadTablerSource } from './tabler'

const attributeNames = (nodes: IconNode[]): string[] =>
	nodes.flatMap(([, attrs, children]) => [
		...Object.keys(attrs),
		...(children ? attributeNames(children) : []),
	])

describe('loadTablerSource', () => {
	// React rejects raw SVG names as DOM properties; tabler's own data has `stroke-width` on a `<g>`.
	it('hands React-ready attribute names to the drawer', () => {
		const { nodes } = loadTablerSource()
		const hyphenated = Object.values(nodes ?? {})
			.flatMap(attributeNames)
			.filter((name) => name.includes('-') && !/^(aria|data)-/.test(name))
		expect(hyphenated).toEqual([])
	})
})
