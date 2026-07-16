import type { Condition, Field } from 'payload'
import { describe, expect, it } from 'vitest'
import { buildConsentSourceConfig } from './buildConsentSourceConfig'
import { buildDefaultConsentSources } from './builtin'
import { defineConsentSource } from './defineConsentSource'
import { resolveConsentSources } from './registry'

type ConditionProps = Parameters<Condition>[2]

/**
 * Payload types `blockData` as always present but documents it as `undefined` for fields
 * outside a block; the cast lets the test exercise that documented runtime shape.
 */
const conditionProps = (blockData: Record<string, unknown> | undefined): ConditionProps =>
	({
		blockData,
		operation: 'update',
		path: ['fields', 0, 'sourceConfig'],
		user: null,
	}) as ConditionProps

const conditionOf = (field: Field): Condition => {
	const admin = field.admin as { condition?: Condition } | undefined
	if (typeof admin?.condition !== 'function') {
		throw new Error(`expected admin.condition on ${'name' in field ? field.name : field.type}`)
	}
	return admin.condition
}

const childNamed = (children: Field[], name: string): Field => {
	const field = children.find((f) => 'name' in f && f.name === name)
	if (!field) {
		throw new Error(`missing sourceConfig field: ${name}`)
	}
	return field
}

describe('buildConsentSourceConfig', () => {
	const registry = resolveConsentSources(buildDefaultConsentSources(true))
	const [select, group] = buildConsentSourceConfig(registry)
	const children = group?.type === 'group' ? group.fields : []

	it('builds the source select from the registry with a static default that cannot be cleared', () => {
		expect(select).toMatchObject({
			name: 'source',
			type: 'select',
			defaultValue: 'static',
			admin: { isClearable: false },
		})
		const options = select?.type === 'select' ? select.options : []
		expect(options.map((option) => (typeof option === 'string' ? option : option.value))).toEqual([
			'static',
			'pageReference',
		])
	})

	const cases: [string, string[]][] = [
		['static', ['label', 'url', 'version']],
		['pageReference', ['relationTo', 'docId', 'urlField', 'captureVersion']],
	]

	for (const [source, names] of cases) {
		it(`shows ${source} config fields exactly when blockData.source is ${source}`, () => {
			for (const name of names) {
				const condition = conditionOf(childNamed(children, name))
				expect(condition({}, {}, conditionProps({ source }))).toBe(true)
				expect(condition({}, {}, conditionProps({ source: 'somethingElse' }))).toBe(false)
			}
		})
	}

	it('ignores top-level document data when gating sourceConfig fields', () => {
		const condition = conditionOf(childNamed(children, 'url'))
		expect(condition({ source: 'static' }, { source: 'static' }, conditionProps({}))).toBe(false)
	})

	it('hides sourceConfig fields when the field sits outside a block', () => {
		const condition = conditionOf(childNamed(children, 'url'))
		expect(condition({}, {}, conditionProps(undefined))).toBe(false)
	})

	it('falls back to a hidden placeholder when no source declares config fields', () => {
		const bare = defineConsentSource({
			type: 'custom',
			label: 'customSourceLabel',
			resolve: () => ({ links: [] }),
		})
		const [bareSelect, bareGroup] = buildConsentSourceConfig(new Map([['custom', bare]]))
		expect(bareSelect).toMatchObject({ name: 'source', defaultValue: 'custom' })
		const bareChildren = bareGroup?.type === 'group' ? bareGroup.fields : []
		expect(bareChildren).toHaveLength(1)
		expect(bareChildren[0]).toMatchObject({
			name: '_placeholder',
			type: 'text',
			admin: { hidden: true },
		})
	})
})
