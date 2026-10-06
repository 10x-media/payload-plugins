import type { CollectionSlug, Field } from 'payload'

import { createdByField, lastModifiedByField } from '../fields/index'
import type { AuditHookFieldConfig } from '../hooks/beforeChangeCollection'
import type { AuditOptions, AuditPluginConfig, GlobalAuditOptions } from '../types'
import {
	isPolymorphicRelationTo,
	mergeWithDefaults,
	resolveFieldOptions,
	resolveHookPath,
} from './resolveOptions'

export type AuditHookConfig = {
	createdByHookConfig: AuditHookFieldConfig | false
	/** The entity's fields with any automatic audit fields appended. */
	fields: Field[]
	hasActiveFields: boolean
	lastModifiedByHookConfig: AuditHookFieldConfig | false
}

/**
 * Works out which of `createdBy` / `lastModifiedBy` are active for one collection or
 * global, appends the fields the plugin owns, and returns the matching hook config.
 *
 * Manual fields are declared by the host, so they are configured for the hook but not
 * appended here.
 */
// biome-ignore lint/complexity/useMaxParams: field list, per-entity options, relationTo and plugin defaults are independent inputs
export const buildAuditConfig = (
	existingFields: Field[],
	auditOptions: AuditOptions | GlobalAuditOptions,
	defaultRelationTo: CollectionSlug | CollectionSlug[],
	pluginDefaults: AuditPluginConfig['defaults']
): AuditHookConfig => {
	const fields = [...existingFields]

	const createdByOptions = mergeWithDefaults(
		resolveFieldOptions(auditOptions, 'createdBy'),
		pluginDefaults?.createdBy
	)
	const lastModifiedByOptions = mergeWithDefaults(
		resolveFieldOptions(auditOptions, 'lastModifiedBy'),
		pluginDefaults?.lastModifiedBy
	)

	if (createdByOptions !== false && !createdByOptions.isManual) {
		fields.push(
			createdByField(
				{ relationTo: defaultRelationTo, ...createdByOptions },
				createdByOptions.overrides
			)
		)
	}

	if (lastModifiedByOptions !== false && !lastModifiedByOptions.isManual) {
		fields.push(
			lastModifiedByField(
				{ relationTo: defaultRelationTo, ...lastModifiedByOptions },
				lastModifiedByOptions.overrides
			)
		)
	}

	const resolvedCreatedByRelationTo =
		createdByOptions !== false
			? (createdByOptions.relationTo ?? defaultRelationTo)
			: defaultRelationTo

	const resolvedLastModifiedByRelationTo =
		lastModifiedByOptions !== false
			? (lastModifiedByOptions.relationTo ?? defaultRelationTo)
			: defaultRelationTo

	const createdByHookConfig: AuditHookFieldConfig | false =
		createdByOptions !== false
			? {
					isPolymorphic: createdByOptions.isManual
						? (createdByOptions.isPolymorphic ?? false)
						: isPolymorphicRelationTo(resolvedCreatedByRelationTo),
					path: resolveHookPath(createdByOptions, 'createdBy'),
					relationTo: resolvedCreatedByRelationTo,
				}
			: false

	const lastModifiedByHookConfig: AuditHookFieldConfig | false =
		lastModifiedByOptions !== false
			? {
					isPolymorphic: lastModifiedByOptions.isManual
						? (lastModifiedByOptions.isPolymorphic ?? false)
						: isPolymorphicRelationTo(resolvedLastModifiedByRelationTo),
					path: resolveHookPath(lastModifiedByOptions, 'lastModifiedBy'),
					relationTo: resolvedLastModifiedByRelationTo,
				}
			: false

	return {
		createdByHookConfig,
		fields,
		hasActiveFields: createdByHookConfig !== false || lastModifiedByHookConfig !== false,
		lastModifiedByHookConfig,
	}
}
