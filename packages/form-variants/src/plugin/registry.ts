import type { Config, PayloadComponent, SanitizedConfig } from 'payload'

import type {
	AfterSaveHook,
	DefaultVariant,
	GateResult,
	SlotComponents,
	StepContext,
	StepSlotComponents,
	VariantAccess,
	VariantLabel,
	VariantUI,
} from '../types'
import { REGISTRY_KEY } from './constants'

export type ResolvedFieldItem =
	| { Component: PayloadComponent; type: 'component' }
	| {
			description?: VariantLabel
			label?: VariantLabel
			path: string
			type: 'field'
	  }

export type ResolvedStep = {
	Component?: PayloadComponent
	components?: StepSlotComponents
	condition?: (ctx: StepContext) => boolean | Promise<boolean>
	description?: VariantLabel
	gate?: (ctx: StepContext) => GateResult | Promise<GateResult>
	items: ResolvedFieldItem[]
	key: string
	kind: 'component' | 'fields'
	label?: VariantLabel
}

/** A variant's presentation with every default filled in. */
export type ResolvedUI = Required<VariantUI>

export type ResolvedVariant = {
	access?: VariantAccess
	afterSave?: AfterSaveHook
	components?: SlotComponents
	key: string
	label?: VariantLabel
	native: boolean
	navigation: 'free' | 'linear'
	save: 'always' | 'final-step'
	steps: ResolvedStep[]
	ui: ResolvedUI
}

export type ResolvedCollection = {
	components?: SlotComponents
	defaultVariant?: DefaultVariant
	slug: string
	/** Always holds `native`, appended last when the config did not list it. */
	variants: ResolvedVariant[]
}

/**
 * What the plugin parks under `config.custom`. `custom` is listed in Payload's
 * `serverOnlyConfigProperties`, so access functions and component paths never reach the browser.
 */
export type FormVariantsRegistry = {
	collections: Record<string, ResolvedCollection>
	components?: SlotComponents
}

export const setRegistry = (config: Config, registry: FormVariantsRegistry): void => {
	config.custom ??= {}
	config.custom[REGISTRY_KEY] = registry
}

/** The registry at runtime, or `undefined` when the plugin did not run. */
export const getRegistry = (
	config: Pick<Config | SanitizedConfig, 'custom'>
): FormVariantsRegistry | undefined =>
	(config.custom as Record<string, FormVariantsRegistry | undefined> | undefined)?.[REGISTRY_KEY]

/** One collection's resolved variants, or `undefined` when it is not configured. */
export const getCollectionVariants = (
	config: Pick<Config | SanitizedConfig, 'custom'>,
	slug: string
): ResolvedCollection | undefined => getRegistry(config)?.collections[slug]
