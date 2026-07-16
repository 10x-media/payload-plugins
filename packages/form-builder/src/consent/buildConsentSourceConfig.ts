import type { Condition, Field } from 'payload'
import { keys } from '../translations/keys'
import { labelFor } from '../translations/server'
import type { ConsentSourceRegistry } from './registry'

/**
 * Builds the `source` select and `sourceConfig` group for the consent field block.
 * Fields inside `sourceConfig` are annotated with `admin.condition` so only the
 * fields that belong to the currently selected source type are visible in the admin UI.
 * The `source` select lives at block-row level, a sibling of the group, so conditions
 * read `blockData`, never the top-level document data.
 *
 * `resolveConsentLinks` reads `field.sourceConfig` as a flat object; field names within
 * that group must be unique across all registered sources. Built-in sources (static,
 * pageReference) have no overlapping names. Custom sources should follow the same rule.
 */
export const buildConsentSourceConfig = (registry: ConsentSourceRegistry): Field[] => {
	const sources = [...registry.values()]
	const firstType = sources[0]?.type ?? 'static'

	const sourceConfigFields: Field[] = sources.flatMap((source) =>
		(source.config ?? []).map((field) => {
			const existingAdmin =
				typeof field.admin === 'object' && field.admin !== null ? field.admin : {}
			const condition: Condition = (_data, _siblingData, { blockData }) =>
				(blockData as Record<string, unknown> | undefined)?.source === source.type
			return {
				...field,
				admin: {
					...existingAdmin,
					condition,
				},
			} as Field
		})
	)

	return [
		{
			name: 'source',
			type: 'select',
			defaultValue: firstType,
			label: labelFor(keys.consentConfigSource),
			admin: { isClearable: false },
			options: sources.map((s) => ({
				label: labelFor(s.label),
				value: s.type,
			})),
		},
		{
			name: 'sourceConfig',
			type: 'group',
			label: labelFor(keys.consentConfigSourceConfig),
			fields:
				sourceConfigFields.length > 0
					? sourceConfigFields
					: [{ name: '_placeholder', type: 'text', admin: { hidden: true } }],
		},
	]
}
