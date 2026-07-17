import type { SanitizedConfig, StaticLabel } from 'payload'
import { getFieldsRegistry } from '../../../plugin/registry'
import type { IconAdapter } from '../../../types'

/** Selectable libraries for `iconLibraryField()`, from inline adapters or the plugin registry. */
export const getIconLibraryOptions = (
	config: SanitizedConfig,
	inline?: IconAdapter[]
): { label: StaticLabel; value: string }[] => {
	const adapters = inline ?? getFieldsRegistry(config)?.icon?.adapters ?? []
	return adapters.map((adapter) => ({ label: adapter.label, value: adapter.slug }))
}
