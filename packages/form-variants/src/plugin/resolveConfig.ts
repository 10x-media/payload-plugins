import type { CollectionConfig, CollectionSlug } from 'payload'

import type { FieldItem, FormVariantsCollections, FormVariantsConfig, Step } from '../types'
import { COLLECTION_CUSTOM_KEY, NATIVE_KEY } from './constants'
import type {
	ResolvedCollection,
	ResolvedFieldItem,
	ResolvedStep,
	ResolvedUI,
	ResolvedVariant,
} from './registry'

/** Payload's own form is full width and starts at the left, so that is where a variant starts. */
const DEFAULT_UI: ResolvedUI = { align: 'left', width: 'full' }

const fail = (message: string): never => {
	throw new Error(`[form-variants] ${message}`)
}

/** Reads `custom.formVariants` off a collection, if present. */
export const readCollectionConfig = (
	collection: CollectionConfig
): FormVariantsConfig | undefined => {
	const value = collection.custom?.[COLLECTION_CUSTOM_KEY] as FormVariantsConfig | undefined
	return value && typeof value === 'object' ? value : undefined
}

const resolveItem = (item: FieldItem<CollectionSlug>): ResolvedFieldItem => {
	if (typeof item === 'string') {
		return { path: item, type: 'field' }
	}
	if ('type' in item) {
		return { Component: item.Component, type: 'component' }
	}
	return {
		description: item.description,
		label: item.label,
		path: item.path as string,
		type: 'field',
	}
}

const resolveStep = (step: Step<CollectionSlug>): ResolvedStep => ({
	Component: step.Component,
	components: step.components,
	condition: step.condition,
	description: step.description,
	gate: step.gate,
	items: step.fields ? step.fields.map(resolveItem) : [],
	key: step.key,
	kind: step.Component ? 'component' : 'fields',
	label: step.label,
})

/**
 * Normalizes one collection's config: defaults filled in, and `native` present exactly once,
 * appended last and open to everyone when the config did not list it.
 */
export const resolveCollection = (slug: string, config: FormVariantsConfig): ResolvedCollection => {
	const variants: ResolvedVariant[] = config.variants.map((variant) => {
		if (variant.key === NATIVE_KEY) {
			return {
				access: variant.access,
				key: NATIVE_KEY,
				label: variant.label,
				native: true,
				navigation: 'linear',
				save: 'always',
				steps: [],
				ui: DEFAULT_UI,
			}
		}
		const steps = (variant.steps ?? []).map(resolveStep)
		return {
			access: variant.access,
			afterSave: variant.afterSave,
			components: variant.components,
			key: variant.key,
			label: variant.label,
			native: false,
			navigation: variant.navigation ?? 'linear',
			// A single step is always the final one, so the two policies permit exactly the same
			// saves and only the button's place differs. `always` puts it where Payload puts it.
			save: variant.save ?? (steps.length === 1 ? 'always' : 'final-step'),
			steps,
			ui: {
				align: variant.ui?.align ?? DEFAULT_UI.align,
				width: variant.ui?.width ?? DEFAULT_UI.width,
			},
		}
	})

	if (!variants.some((variant) => variant.native)) {
		variants.push({
			key: NATIVE_KEY,
			native: true,
			navigation: 'linear',
			save: 'always',
			steps: [],
			ui: DEFAULT_UI,
		})
	}

	return {
		components: config.components,
		defaultVariant: config.defaultVariant,
		slug,
		variants,
	}
}

/**
 * Collects every configured collection from both places a config may live. A slug declared
 * in both fails here, named, rather than merging silently.
 */
export const collectConfigs = (
	collections: CollectionConfig[],
	fromOptions: FormVariantsCollections | undefined
): Record<string, ResolvedCollection> => {
	const known = new Set(collections.map((collection) => collection.slug))
	const out: Record<string, ResolvedCollection> = {}

	for (const collection of collections) {
		const config = readCollectionConfig(collection)
		if (config) {
			out[collection.slug] = resolveCollection(collection.slug, config)
		}
	}

	for (const [slug, config] of Object.entries(fromOptions ?? {})) {
		if (!config) {
			continue
		}
		if (!known.has(slug)) {
			fail(
				`Unknown collection slug "${slug}" in plugin options. The plugin only sees collections present when it runs, so list formVariants() after any plugin that adds this collection.`
			)
		}
		if (out[slug]) {
			fail(
				`Collection "${slug}" is configured both on the collection (custom.formVariants) and in the plugin options. Keep one.`
			)
		}
		out[slug] = resolveCollection(slug, config as FormVariantsConfig)
	}

	return out
}
