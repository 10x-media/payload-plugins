import type { Block, Config, Field } from 'payload'
import { describe, expect, it } from 'vitest'
import { analytics } from '../index'
import { memoryAdapter } from '../testing/memoryAdapter'
import { analyticsLinkFields } from './linkFields'
import { applyRevenueVisibility, moneyField } from './moneyFields'
import { trackGoalAction } from './trackGoalAction'

const shown = (field: Field | undefined, siblingData: Record<string, unknown> = {}): boolean =>
	field?.admin?.condition?.({}, siblingData, {} as never) !== false

const named = (fields: Field[], name: string): Field | undefined =>
	fields.find((field) => 'name' in field && field.name === name)

const nested = (field: Field | undefined): Field[] => {
	if (field && 'fields' in field && Array.isArray(field.fields)) {
		return field.fields
	}
	if (field && 'tabs' in field) {
		return field.tabs.flatMap((tab) => tab.fields)
	}
	return []
}

const configWith = (fields: Field[]): Config =>
	({ collections: [{ slug: 'pages', fields }] }) as unknown as Config

const pagesOf = (config: Config): Field[] => config.collections?.[0]?.fields ?? []

describe('applyRevenueVisibility', () => {
	it('hides a tagged field wherever it sits and leaves the rest alone', () => {
		const fields: Field[] = [
			{ name: 'title', type: 'text' },
			{
				type: 'tabs',
				tabs: [
					{
						label: 'Money',
						fields: [moneyField({ name: 'amount', type: 'number' })],
					},
				],
			},
		]

		applyRevenueVisibility(fields, false)

		expect(shown(named(nested(fields[1]), 'amount'))).toBe(false)
		expect(shown(named(fields, 'title'))).toBe(true)
	})

	it('leaves every field as it was while the install measures money', () => {
		const fields: Field[] = [moneyField({ name: 'amount', type: 'number' })]

		applyRevenueVisibility(fields, true)

		expect(shown(named(fields, 'amount'))).toBe(true)
	})
})

// Each config's `revenue` decides for its own fields, never one booted later in the same process.
describe('two configs in one process', () => {
	it('each hides its own money fields', async () => {
		const withMoney = configWith(analyticsLinkFields({ value: true }))
		const withoutMoney = configWith(analyticsLinkFields({ value: true }))

		await analytics({ adapters: [memoryAdapter()], revenue: true })(withMoney)
		await analytics({ adapters: [memoryAdapter()], revenue: false })(withoutMoney)

		expect(shown(named(pagesOf(withMoney), 'goalValue'), { goal: 'purchase' })).toBe(true)
		expect(shown(named(pagesOf(withoutMoney), 'goalValue'), { goal: 'purchase' })).toBe(false)
	})

	it('hides them under a collection the host nested them in', async () => {
		const config = configWith([{ type: 'row', fields: analyticsLinkFields({ value: true }) }])

		await analytics({ adapters: [memoryAdapter()], revenue: false })(config)

		expect(shown(named(nested(pagesOf(config)[0]), 'goalValue'), { goal: 'x' })).toBe(false)
	})
})

describe('blocks', () => {
	const cta = (): Block => ({ slug: 'cta', fields: analyticsLinkFields({ value: true }) })

	// `blockReferences` name blocks the config defines once at its top level, which no
	// collection's field tree contains.
	it('hides the money fields of a block the config defines for blockReferences', async () => {
		const config = { collections: [], blocks: [cta()] } as unknown as Config

		await analytics({ adapters: [memoryAdapter()], revenue: false })(config)

		const fields = config.blocks?.[0]?.fields ?? []
		expect(shown(named(fields, 'goalValue'), { goal: 'purchase' })).toBe(false)
		expect(shown(named(fields, 'goal'))).toBe(true)
	})

	it('hides them in a block defined inline inside a blocks field', async () => {
		const config = configWith([{ name: 'layout', type: 'blocks', blocks: [cta()] }])

		await analytics({ adapters: [memoryAdapter()], revenue: false })(config)

		const layout = pagesOf(config)[0]
		const fields = layout && 'blocks' in layout ? (layout.blocks[0]?.fields ?? []) : []
		expect(shown(named(fields, 'goalValue'), { goal: 'purchase' })).toBe(false)
	})

	it('leaves a block alone while the install measures money', async () => {
		const config = { collections: [], blocks: [cta()] } as unknown as Config

		await analytics({ adapters: [memoryAdapter()], revenue: true })(config)

		expect(shown(named(config.blocks?.[0]?.fields ?? [], 'goalValue'), { goal: 'x' })).toBe(true)
	})
})

describe('factory options for fields the plugin cannot reach', () => {
	it('offers the action money inputs by default and drops them on request', () => {
		expect(shown(named(trackGoalAction().config, 'value'))).toBe(true)
		expect(shown(named(trackGoalAction({ revenue: false }).config, 'value'))).toBe(false)
		expect(shown(named(trackGoalAction({ revenue: false }).config, 'currency'))).toBe(false)
		expect(shown(named(trackGoalAction({ revenue: false }).config, 'goal'))).toBe(true)
	})

	it('does the same for a link value the plugin never sees in the config', () => {
		const fields = analyticsLinkFields({ value: true, revenue: false })
		expect(shown(named(fields, 'goalValue'), { goal: 'purchase' })).toBe(false)
	})
})
