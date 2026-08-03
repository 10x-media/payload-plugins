import type { Config } from 'payload'
import { FIELDS_REGISTRY_KEY } from '../../plugin/registry'
import type { FieldsPluginRegistry, IconGlobalConfig, IconRenderStrategy } from '../../types'

/** The importMap path a render strategy needs registered, so generate:importmap picks it up. */
const renderDependency = (
	render: IconRenderStrategy
): { path: string; type: 'function' | 'component' } =>
	render.type === 'component'
		? { path: render.Icon, type: 'component' }
		: { path: render.type === 'url' ? render.resolve : render.load, type: 'function' }

/**
 * Slugs prefix every stored value (`<slug>:<icon-name>`), so a slug carrying a
 * `:` would parse back as a different library and name. Same shape as the icon
 * names codegen accepts.
 */
const ADAPTER_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/

/**
 * Writes normalized icon globals to the plugin registry and forces the
 * adapters' client components into the importMap via admin.dependencies
 * (registry strings are not scanned by generate:importmap).
 */
export const registerIcon = (config: Config, icon: IconGlobalConfig | undefined): void => {
	if (!icon?.adapters) {
		return
	}
	const [firstAdapter] = icon.adapters
	if (!firstAdapter) {
		return
	}
	const slugs = new Set<string>()
	for (const adapter of icon.adapters) {
		if (!ADAPTER_SLUG.test(adapter.slug)) {
			throw new Error(
				`[fields] invalid icon adapter slug: "${adapter.slug}" (expected kebab-case, e.g. "my-icons")`
			)
		}
		if (slugs.has(adapter.slug)) {
			throw new Error(`[fields] duplicate icon adapter slug: ${adapter.slug}`)
		}
		slugs.add(adapter.slug)
		// Layer ids key the manifest cache, so a duplicate would make two layers share
		// one cached listing and silently serve the wrong one.
		const layerIds = new Set<string>()
		for (const layer of adapter.layers ?? []) {
			if (layerIds.has(layer.id)) {
				throw new Error(
					`[fields] duplicate icon layer id "${layer.id}" in adapter "${adapter.slug}"`
				)
			}
			layerIds.add(layer.id)
		}
	}
	const defaultLibrary = icon.defaultLibrary ?? firstAdapter.slug
	if (!slugs.has(defaultLibrary)) {
		throw new Error(`[fields] defaultLibrary "${defaultLibrary}" is not a registered icon adapter`)
	}
	config.custom ??= {}
	const registry = (config.custom[FIELDS_REGISTRY_KEY] ?? {}) as FieldsPluginRegistry
	registry.icon = {
		adapters: icon.adapters,
		alwaysAvailable: icon.alwaysAvailable,
		defaultLibrary,
		resolveAvailable: icon.resolveAvailable,
	}
	config.custom[FIELDS_REGISTRY_KEY] = registry
	config.admin ??= {}
	config.admin.dependencies ??= {}
	for (const adapter of icon.adapters) {
		config.admin.dependencies[`fields-icon-${adapter.slug}-Icon`] = {
			path: adapter.Icon,
			type: 'component',
		}
		config.admin.dependencies[`fields-icon-${adapter.slug}-Assets`] = {
			path: adapter.Assets,
			type: 'component',
		}
		// generate:importmap scans admin.dependencies, not registry strings, so the
		// optional Nodes loader must be registered here too or a regeneration drops
		// it and the drawer silently loses the bulk node-data fast path.
		if (adapter.Nodes) {
			config.admin.dependencies[`fields-icon-${adapter.slug}-Nodes`] = {
				path: adapter.Nodes,
				type: 'component',
			}
		}
		// Each layer's render strategy points at its own importMap entry. Registered here
		// for the same reason Nodes is: generate:importmap scans admin.dependencies, not
		// registry strings, so a regeneration would otherwise drop them.
		for (const layer of adapter.layers ?? []) {
			config.admin.dependencies[`fields-icon-${adapter.slug}-${layer.id}`] = renderDependency(
				layer.render
			)
		}
	}
}
