import type { CollectionConfig, Config, EditConfig, PayloadComponent } from 'payload'

import type { SlotComponents } from '../types'
import { DEPENDENCY_PREFIX, VIEW_PATH } from './constants'
import type { ResolvedCollection, ResolvedFieldItem } from './registry'

type Dependencies = NonNullable<NonNullable<Config['admin']>['dependencies']>

/** The string form of a component path, whichever way it was declared. */
const pathOf = (component: PayloadComponent): string | undefined => {
	if (typeof component === 'string') {
		return component
	}
	return typeof component === 'object' && component ? component.path : undefined
}

const SLOT_NAMES = [
	'Layout',
	'Navigation',
	'Outcome',
	'Progress',
	'StepHeader',
	'VariantSwitcher',
] as const satisfies readonly (keyof SlotComponents)[]

/**
 * Every component path the config mentions, registered in `admin.dependencies` so the import
 * map generator finds it. It has to be told: the variants live under `config.custom` and a
 * collection's `custom`, which the generator does not walk.
 */
export const collectDependencies = (
	collections: Record<string, ResolvedCollection>,
	pluginSlots: SlotComponents | undefined
): Dependencies => {
	const dependencies: Dependencies = {
		[`${DEPENDENCY_PREFIX}-view`]: { type: 'component', path: VIEW_PATH },
	}

	const add = (key: string, component: false | PayloadComponent | undefined): void => {
		const path = component ? pathOf(component) : undefined
		if (path) {
			dependencies[key] = { path, type: 'component' }
		}
	}

	const addSlots = (key: string, slots: SlotComponents | undefined): void => {
		for (const slot of SLOT_NAMES) {
			add(`${key}-${slot}`, slots?.[slot])
		}
	}

	/**
	 * Component items anywhere in a step, containers included. A step's `row`, `collapsible` and
	 * `group` nest freely and may hold components, and the render walk descends into them, so this
	 * one has to as well or a nested component is rendered from an import map that never heard of it.
	 * The key follows the same dotted index path the renderer addresses the item by.
	 */
	const addItems = (stepKey: string, items: ResolvedFieldItem[], prefix: string): void => {
		items.forEach((item, index) => {
			const at = prefix === '' ? String(index) : `${prefix}.${index}`
			if (item.type === 'component') {
				add(`${stepKey}-item-${at}`, item.Component)
				return
			}
			if ('items' in item) {
				addItems(stepKey, item.items, at)
			}
		})
	}

	addSlots(`${DEPENDENCY_PREFIX}-slot`, pluginSlots)

	for (const collection of Object.values(collections)) {
		addSlots(`${DEPENDENCY_PREFIX}-slot-${collection.slug}`, collection.components)
		for (const variant of collection.variants) {
			const variantKey = `${DEPENDENCY_PREFIX}-${collection.slug}-${variant.key}`
			addSlots(`${variantKey}-slot`, variant.components)
			for (const step of variant.steps) {
				const stepKey = `${variantKey}-${step.key}`
				add(`${stepKey}-component`, step.Component)
				addSlots(`${stepKey}-slot`, step.components)
				addItems(stepKey, step.items, '')
			}
		}
	}

	return dependencies
}

/** The collection with the plugin's edit view registered as `edit.default`. */
export const withVariantView = (collection: CollectionConfig): CollectionConfig => ({
	...collection,
	admin: {
		...collection.admin,
		components: {
			...collection.admin?.components,
			views: {
				...collection.admin?.components?.views,
				edit: {
					...collection.admin?.components?.views?.edit,
					default: { Component: VIEW_PATH },
				} as EditConfig,
			},
		},
	},
})
