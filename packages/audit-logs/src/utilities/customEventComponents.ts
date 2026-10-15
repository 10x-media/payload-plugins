import type { AdminDependencies, PayloadComponent } from 'payload'
import { parsePayloadComponent } from 'payload/shared'

import type { CustomEventComponents } from '../types'

const WILDCARD = '*'

/**
 * The renderer for one event type: its own entry first, then the wildcard, with
 * `false` collapsing to "no renderer" so the default block is used.
 */
export const resolveCustomEventComponent = (
	components: CustomEventComponents | undefined,
	eventType: string | undefined
): PayloadComponent | undefined => {
	if (!components) return undefined
	const exact =
		eventType !== undefined && Object.hasOwn(components, eventType)
			? components[eventType]
			: undefined
	const chosen = exact === undefined ? components[WILDCARD] : exact
	return chosen === false ? undefined : chosen
}

const dependencyOf = (key: string, component: PayloadComponent): AdminDependencies => {
	const parsed = parsePayloadComponent(component)
	if (!parsed) return {}
	const { clientProps, serverProps } = typeof component === 'object' ? component : {}
	return {
		[key]: {
			...(clientProps ? { clientProps } : {}),
			path: `${parsed.path}#${parsed.exportName}`,
			...(serverProps ? { serverProps } : {}),
			type: 'component' as const,
		},
	}
}

/**
 * Import-map entries for every configured renderer. The paths live in plugin
 * options rather than in a component slot the generator walks, so without this
 * registration `generate:importmap` would never see them.
 */
export const collectCustomEventDependencies = (
	components: CustomEventComponents | undefined
): AdminDependencies =>
	Object.fromEntries(
		Object.entries(components ?? {}).flatMap(([eventType, component]) =>
			component === false
				? []
				: Object.entries(dependencyOf(`@10x-media/audit-logs:customEvent:${eventType}`, component))
		)
	)

/** The view slots other than `customEvents`, each one component or several. */
export const VIEW_SLOTS = [
	'afterList',
	'afterRowDetails',
	'beforeList',
	'beforeRowDetails',
	'rowBadges',
	'user',
] as const

export type ViewSlot = (typeof VIEW_SLOTS)[number]

/** Import-map entries for every slot component, for the same reason as custom events. */
export const collectSlotDependencies = (
	components: Partial<Record<ViewSlot, PayloadComponent | PayloadComponent[]>> | undefined
): AdminDependencies =>
	Object.assign(
		{},
		...VIEW_SLOTS.flatMap((slot) => {
			const value = components?.[slot]
			if (!value) return []
			const list = Array.isArray(value) ? value : [value]
			return list.map((component, index) =>
				dependencyOf(`@10x-media/audit-logs:${slot}:${index}`, component)
			)
		})
	)
