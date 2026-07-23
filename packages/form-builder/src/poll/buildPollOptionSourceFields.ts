import type { Field } from 'payload'
import { keys } from '../translations/keys'
import { labelForKey, resolveDefinitionLabel } from '../translations/server'
import type { PollOptionSourceRegistry } from './registry'

/**
 * Builds the `optionSource` select and `sourceConfig` group for the forms poll group; returns
 * nothing when no sources are registered, so the fields only exist for hosts that opted in.
 * Fields inside `sourceConfig` are annotated with `admin.condition` so only the fields of the
 * currently selected source type are visible; like consent's `sourceConfig`, field names within
 * the group must be unique across all registered sources. Unlike consent's `source` select there
 * is no default: hand-authored options remain the baseline and a source is an explicit opt-in per
 * form (the select stays clearable).
 */
export const buildPollOptionSourceFields = (registry: PollOptionSourceRegistry): Field[] => {
	const sources = [...registry.values()]
	if (sources.length === 0) {
		return []
	}

	const sourceConfigFields: Field[] = sources.flatMap((source) =>
		(source.config ?? []).map((field) => {
			const existingAdmin =
				typeof field.admin === 'object' && field.admin !== null ? field.admin : {}
			return {
				...field,
				admin: {
					...existingAdmin,
					condition: (data: unknown) =>
						(data as { poll?: { optionSource?: string } })?.poll?.optionSource === source.type,
				},
			} as Field
		})
	)

	return [
		{
			name: 'optionSource',
			type: 'select',
			label: labelForKey(keys.pollOptionSource),
			admin: {
				description: labelForKey(keys.pollOptionSourceDescription),
			},
			options: sources.map((source) => ({
				label: resolveDefinitionLabel(source.label),
				value: source.type,
			})),
		},
		{
			name: 'sourceConfig',
			type: 'group',
			label: labelForKey(keys.pollSourceConfig),
			admin: {
				condition: (_data, siblingData) => Boolean(siblingData?.optionSource),
			},
			fields:
				sourceConfigFields.length > 0
					? sourceConfigFields
					: [{ name: '_placeholder', type: 'text', admin: { hidden: true } }],
		},
	]
}
