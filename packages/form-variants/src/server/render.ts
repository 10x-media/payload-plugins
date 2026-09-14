import { RenderServerComponent } from '@payloadcms/ui/elements/RenderServerComponent'
import type { ImportMap, PayloadComponent } from 'payload'
import type React from 'react'

import type { RenderedSlots, RenderedVariantSlots } from '../client/types'
import type { ResolvedCollection, ResolvedFieldItem, ResolvedVariant } from '../plugin/registry'
import type { SlotComponents } from '../types'
import { itemIndexPath, renderedKey } from './manifest'

type RenderArgs = {
	importMap: ImportMap
	serverProps: object
}

const SLOT_NAMES = [
	'Layout',
	'Navigation',
	'Outcome',
	'Progress',
	'StepHeader',
	'VariantSwitcher',
] as const satisfies readonly (keyof SlotComponents)[]

const render = (
	args: RenderArgs,
	component: PayloadComponent | undefined,
	clientProps: object
): React.ReactNode =>
	component
		? RenderServerComponent({
				clientProps,
				Component: component,
				importMap: args.importMap,
				serverProps: args.serverProps,
			})
		: undefined

/**
 * Renders every configured slot replacement of one level (plugin, collection, variant or
 * step); a slot set to `false` stays `false` so the client hides that part. Slots are
 * rendered here so a replacement may be a server component, as any custom
 * admin component may. Only serializable props cross the boundary; the live half (current
 * step, guard state) reaches a replacement through the hooks in `exports/client`.
 */
export const renderSlots = (
	args: RenderArgs,
	components: SlotComponents | undefined,
	clientProps: object
): RenderedSlots => {
	const out: RenderedSlots = {}
	if (!components) {
		return out
	}
	for (const slot of SLOT_NAMES) {
		const component = components[slot]
		if (component === false) {
			out[slot] = false
			continue
		}
		const node = render(args, component, clientProps)
		if (node !== undefined) {
			out[slot] = node
		}
	}
	return out
}

/**
 * Pre-renders one variant: its component steps, its component items, and its slot
 * replacements at variant and step level. Every available variant is rendered on every
 * request so the account can switch on the client without a navigation.
 */
export const renderVariant = (
	args: RenderArgs,
	collection: ResolvedCollection,
	variant: ResolvedVariant
): { rendered: Record<string, React.ReactNode>; slots: RenderedVariantSlots } => {
	const rendered: Record<string, React.ReactNode> = {}
	const shared = { collection: collection.slug, variant: variant.key }
	const slots: RenderedVariantSlots = {
		steps: {},
		variant: renderSlots(args, variant.components, shared),
	}

	for (const step of variant.steps) {
		const stepProps = { ...shared, step: step.key }
		if (step.Component) {
			rendered[renderedKey(variant.key, step.key)] = render(args, step.Component, stepProps)
		}
		const renderItems = (items: ResolvedFieldItem[], prefix: string): void => {
			items.forEach((item, index) => {
				const at = itemIndexPath(prefix, index)
				if (item.type === 'component') {
					rendered[renderedKey(variant.key, step.key, at)] = render(args, item.Component, stepProps)
					return
				}
				if ('items' in item) {
					renderItems(item.items, at)
				}
			})
		}
		renderItems(step.items, '')
		if (step.components) {
			slots.steps[step.key] = renderSlots(args, step.components, stepProps)
		}
	}

	return { rendered, slots }
}
