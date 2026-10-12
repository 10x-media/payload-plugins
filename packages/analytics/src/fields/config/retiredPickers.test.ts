import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const SOURCE = readFileSync(new URL('./retiredPickers.ts', import.meta.url), 'utf8')

/** Each exported picker with the JSDoc block right above it. */
const documented = (): Array<{ name: string; doc: string }> =>
	[...SOURCE.matchAll(/\/\*\*([\s\S]*?)\*\/\s*export const (\w+)/g)].map((match) => ({
		name: match[2] ?? '',
		doc: match[1] ?? '',
	}))

describe('retired pickers', () => {
	it('tags all five alike: deprecated, under one release tag', () => {
		const pickers = documented()
		expect(pickers.map((picker) => picker.name)).toHaveLength(5)
		for (const picker of pickers) {
			expect(picker.doc, picker.name).toContain('@deprecated')
			expect(picker.doc, picker.name).toContain('@beta')
			expect(picker.doc, picker.name).not.toContain('@internal')
		}
	})
})
