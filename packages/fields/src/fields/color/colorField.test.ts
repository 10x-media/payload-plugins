import type { FieldHook, FieldHookArgs } from 'payload'
import { describe, expect, it } from 'vitest'
import type { ColorFormat } from '../../types'
import { colorField } from './colorField'

type ComponentsShape = {
	Cell: { path: string }
	Field: { clientProps: Record<string, unknown>; path: string }
}

const components = (field: { admin?: { components?: unknown } }): ComponentsShape =>
	field.admin?.components as ComponentsShape

/** Runs a beforeValidate hook with a request whose registry carries `registryFormat`. */
const runHook = (
	hook: FieldHook | undefined,
	value: unknown,
	registryFormat?: ColorFormat
): unknown =>
	hook?.({
		req: {
			payload: {
				config: {
					custom: registryFormat
						? { '@10x-media/fields': { color: { format: registryFormat } } }
						: {},
				},
			},
		},
		value,
	} as unknown as FieldHookArgs)

describe('colorField', () => {
	it('returns a text field with defaults and rsc component paths', () => {
		const field = colorField()
		expect(field.name).toBe('color')
		expect(field.type).toBe('text')
		expect(components(field).Field.path).toBe('@10x-media/fields/rsc#ColorFieldServer')
		expect(components(field).Cell.path).toBe('@10x-media/fields/rsc#ColorCell')
		expect(field.hooks?.beforeValidate).toHaveLength(1)
		expect(typeof field.validate).toBe('function')
	})

	it('ships only serializable client props; preset sources stay server-side in custom', () => {
		const field = colorField({ presets: async () => ['#ffffff'] })
		const clientProps = components(field).Field.clientProps
		expect(JSON.parse(JSON.stringify(clientProps))).toEqual(clientProps)
		expect(JSON.stringify(clientProps)).not.toContain('presets')
		const custom = field.custom?.['@10x-media/fields'] as { presets?: unknown }
		expect(typeof custom.presets).toBe('function')
	})

	it('defaults isClearable to true and forwards false to client props', () => {
		const defaulted = components(colorField()).Field.clientProps.colorOptions as {
			isClearable: boolean
		}
		expect(defaulted.isClearable).toBe(true)
		const disabled = components(colorField({ isClearable: false })).Field.clientProps
			.colorOptions as { isClearable: boolean }
		expect(disabled.isClearable).toBe(false)
	})

	it('linked mode returns the field plus a hidden virtual sibling', () => {
		const [main, resolved] = colorField({
			linked: true,
			name: 'brand',
			presets: [{ key: 'a', value: '#ffffff' }],
		})
		expect(main.name).toBe('brand')
		expect(resolved.name).toBe('brandResolved')
		expect(resolved.virtual).toBe(true)
		expect(resolved.admin?.hidden).toBe(true)
		expect(resolved.admin?.disableListColumn).toBe(true)
		expect(resolved.hooks?.afterRead).toHaveLength(1)
	})

	it('applies function-form overrides and derives the sibling from the overridden name', () => {
		const [main, resolved] = colorField({
			linked: true,
			overrides: ({ field }) => ({ ...field, name: 'accent' }),
		})
		expect(main.name).toBe('accent')
		expect(resolved.name).toBe('accentResolved')
	})

	it('normalizes parseable input to the stored format in beforeValidate', async () => {
		const field = colorField({ format: 'rgb' })
		const hook = field.hooks?.beforeValidate?.[0]
		expect(hook).toBeDefined()
		expect(await runHook(hook, 'red')).toBe('rgb(255 0 0)')
		expect(await runHook(hook, 'not-a-color')).toBe('not-a-color')
	})

	it('strips alpha during normalization when alpha is false', async () => {
		const field = colorField({ alpha: false })
		const hook = field.hooks?.beforeValidate?.[0]
		expect(await runHook(hook, '#ff000080')).toBe('#ff0000')
	})

	it('passes preset references through normalization untouched in linked mode', async () => {
		const [main] = colorField({ linked: true })
		const hook = main.hooks?.beforeValidate?.[0]
		expect(await runHook(hook, 'preset:brand')).toBe('preset:brand')
	})

	it('normalizes to the plugin registry format when the field sets none', async () => {
		const hook = colorField().hooks?.beforeValidate?.[0]
		expect(await runHook(hook, 'red', 'oklch')).toBe('oklch(0.628 0.2577 29.23)')
	})

	it('lets a field-level format win over the plugin registry format', async () => {
		const hook = colorField({ format: 'hex' }).hooks?.beforeValidate?.[0]
		expect(await runHook(hook, 'red', 'oklch')).toBe('#ff0000')
	})

	it('defaults to hex when neither the field nor the plugin sets a format', async () => {
		const hook = colorField().hooks?.beforeValidate?.[0]
		expect(await runHook(hook, 'red')).toBe('#ff0000')
	})
})
