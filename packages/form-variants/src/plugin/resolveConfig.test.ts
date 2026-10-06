import { describe, expect, it } from 'vitest'

import type { FormVariantsConfig, VariantUI } from '../types'
import { resolveCollection } from './resolveConfig'

const withUI = (ui?: VariantUI): FormVariantsConfig => ({
	variants: [{ key: 'quick', steps: [{ key: 'one', fields: ['title'] }], ui }],
})

const uiOf = (ui?: VariantUI) => resolveCollection('posts', withUI(ui)).variants[0]?.ui

describe('resolveCollection ui', () => {
	it('gives both surfaces the defaults when the variant sets nothing', () => {
		expect(uiOf()).toEqual({
			drawer: { align: 'left', width: 'full' },
			page: { align: 'left', width: 'full' },
		})
	})

	it('applies a plain value to both surfaces', () => {
		expect(uiOf({ align: 'center', width: 'half' })).toEqual({
			drawer: { align: 'center', width: 'half' },
			page: { align: 'center', width: 'half' },
		})
	})

	it('applies a surface object to the surface it names', () => {
		expect(uiOf({ align: 'center', width: { drawer: 'full', page: 'half' } })).toEqual({
			drawer: { align: 'center', width: 'full' },
			page: { align: 'center', width: 'half' },
		})
	})

	it('takes the default for a surface the object leaves out', () => {
		expect(uiOf({ width: { page: 'half' } })).toEqual({
			drawer: { align: 'left', width: 'full' },
			page: { align: 'left', width: 'half' },
		})
	})

	it('leaves native at the defaults', () => {
		const collection = resolveCollection('posts', { variants: [{ key: 'native' }] })
		expect(collection.variants[0]?.ui).toEqual({
			drawer: { align: 'left', width: 'full' },
			page: { align: 'left', width: 'full' },
		})
	})
})
