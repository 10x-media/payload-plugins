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

/**
 * Import-map entries for every configured renderer. The paths live in plugin
 * options rather than in a component slot the generator walks, so without this
 * registration `generate:importmap` would never see them.
 */
export const collectCustomEventDependencies = (
	components: CustomEventComponents | undefined
): AdminDependencies =>
	Object.fromEntries(
		Object.entries(components ?? {}).flatMap(([eventType, component]) => {
			if (component === false) return []
			const parsed = parsePayloadComponent(component)
			if (!parsed) return []
			const { clientProps, serverProps } = typeof component === 'object' ? component : {}
			return [
				[
					`@10x-media/audit-logs:customEvent:${eventType}`,
					{
						...(clientProps ? { clientProps } : {}),
						path: `${parsed.path}#${parsed.exportName}`,
						...(serverProps ? { serverProps } : {}),
						type: 'component' as const,
					},
				],
			]
		})
	)
