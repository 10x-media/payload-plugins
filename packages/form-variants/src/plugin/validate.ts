import type { CollectionConfig, CollectionSlug } from 'payload'

import type { FieldItem, FormVariantsConfig, Step } from '../types'
import { NATIVE_KEY } from './constants'
import { collectDataPaths } from './fieldPaths'

const fail = (message: string): never => {
	throw new Error(`[form-variants] ${message}`)
}

/**
 * A collection whose edit view is already overridden is refused. `native` is Payload's
 * `DefaultEditView` and nothing else, and `edit.root` silently takes precedence over
 * `edit.default` in Payload's own view resolution.
 */
const checkEditView = (collection: CollectionConfig): void => {
	const edit = collection.admin?.components?.views?.edit
	if (!edit) {
		return
	}
	if ('root' in edit && edit.root) {
		fail(
			`Collection "${collection.slug}" overrides admin.components.views.edit.root, which replaces the whole document view. Form variants need Payload's default edit view. Remove the root override or leave this collection out.`
		)
	}
	if ('default' in edit && edit.default) {
		fail(
			`Collection "${collection.slug}" already overrides admin.components.views.edit.default. Form variants register that view themselves and cannot wrap an unknown one. Remove the override or leave this collection out.`
		)
	}
}

const checkStep = (args: {
	collection: CollectionConfig
	paths: Map<string, unknown>
	step: Step<CollectionSlug>
	variantKey: string
}): void => {
	const { collection, paths, step, variantKey } = args
	const where = `Collection "${collection.slug}", variant "${variantKey}", step "${step.key}"`
	if (!step.key) {
		fail(`Collection "${collection.slug}", variant "${variantKey}" has a step with no key.`)
	}
	const hasFields = Array.isArray(step.fields)
	const hasComponent = Boolean(step.Component)
	if (hasFields === hasComponent) {
		fail(`${where} must have either \`fields\` or \`Component\`, not both and not neither.`)
	}
	if (!hasFields) {
		return
	}
	const checkItems = (items: FieldItem<CollectionSlug>[]): void => {
		for (const item of items) {
			if (typeof item !== 'string' && item.type === 'component') {
				if (!item.Component) {
					fail(`${where} has a component item with no Component.`)
				}
				continue
			}
			if (typeof item !== 'string' && 'fields' in item) {
				if (!Array.isArray(item.fields) || item.fields.length === 0) {
					fail(`${where} has a "${item.type}" container with no fields.`)
				}
				if (item.type === 'collapsible' && !item.label) {
					fail(`${where} has a collapsible with no label. A lid with no name cannot be opened.`)
				}
				checkItems(item.fields)
				continue
			}
			checkPath(typeof item === 'string' ? item : (item.path as string))
		}
	}

	const checkPath = (path: string): void => {
		if (!path) {
			fail(`${where} lists a field item with no path.`)
		}
		if (!paths.has(path)) {
			const segments = path.split('.')
			const stopped = segments
				.map((_, index) => segments.slice(0, index + 1).join('.'))
				.find((prefix) => {
					const field = paths.get(prefix) as { type?: string } | undefined
					return field && (field.type === 'array' || field.type === 'blocks')
				})
			if (stopped) {
				fail(
					`${where} lists "${path}", but "${stopped}" is an array or blocks field. Rows exist only at runtime, so list "${stopped}" itself and it goes on the step whole.`
				)
			}
			fail(
				`${where} lists unknown field path "${path}". Paths follow the data shape: unnamed rows, collapsibles, tabs and groups contribute no segment.`
			)
		}
	}

	checkItems(step.fields ?? [])
}

/**
 * Config-time checks for one collection. Every message names the collection, the variant
 * and the step, because a plugin that says "invalid config" at boot is a plugin somebody has to
 * debug by bisection.
 */
export const validateCollectionConfig = (
	collection: CollectionConfig,
	config: FormVariantsConfig
): void => {
	checkEditView(collection)

	if (config.slug !== undefined && config.slug !== collection.slug) {
		fail(
			`Collection "${collection.slug}" carries form variants defined for "${config.slug}". Pass the slug of the collection they sit on: defineFormVariants('${collection.slug}', { ... }).`
		)
	}

	if (!Array.isArray(config.variants) || config.variants.length === 0) {
		fail(`Collection "${collection.slug}" has formVariants with no variants.`)
	}

	const paths = collectDataPaths(collection.fields)
	const seen = new Set<string>()

	for (const variant of config.variants) {
		if (!variant.key) {
			fail(`Collection "${collection.slug}" has a variant with no key.`)
		}
		if (seen.has(variant.key)) {
			fail(`Collection "${collection.slug}" lists variant key "${variant.key}" twice.`)
		}
		seen.add(variant.key)

		if (variant.key === NATIVE_KEY) {
			const extra = (['steps', 'save', 'navigation', 'components', 'afterSave'] as const).filter(
				(prop) => variant[prop] !== undefined
			)
			if (extra.length > 0) {
				fail(
					`Collection "${collection.slug}": the "native" variant is Payload's own edit view and accepts only key, label and access (found ${extra.join(', ')}).`
				)
			}
			continue
		}

		if (!Array.isArray(variant.steps) || variant.steps.length === 0) {
			fail(`Collection "${collection.slug}", variant "${variant.key}" has no steps.`)
		}

		const stepKeys = new Set<string>()
		for (const step of variant.steps ?? []) {
			checkStep({ collection, paths, step, variantKey: variant.key })
			if (stepKeys.has(step.key)) {
				fail(
					`Collection "${collection.slug}", variant "${variant.key}" lists step key "${step.key}" twice.`
				)
			}
			stepKeys.add(step.key)
		}
	}

	if (typeof config.defaultVariant === 'string' && !seen.has(config.defaultVariant)) {
		if (config.defaultVariant !== NATIVE_KEY) {
			fail(
				`Collection "${collection.slug}": defaultVariant "${config.defaultVariant}" names no listed variant.`
			)
		}
	}
}
