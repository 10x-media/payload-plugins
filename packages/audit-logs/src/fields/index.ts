import type { RelationshipField } from 'payload'
import type { AuditFieldsCreateOptions, OverrideFunction } from '../types'

const buildAuditRelationshipField = (
	options: AuditFieldsCreateOptions,
	overrides?: OverrideFunction
): RelationshipField => {
	const field = {
		name: options.name,
		type: 'relationship',
		admin: {
			readOnly: true,
			...options.admin,
			components: {
				...(!options.disableCustomComponent && {
					Field: '@10xmedia/payload-audit/client#AuditRelationshipField',
				}),
				...options.admin?.components,
			},
		},
		hasMany: false,
		label: options.label,
		relationTo: options.relationTo,
	} as RelationshipField

	if (overrides) {
		return {
			...overrides(field),
			hasMany: false,
		} as RelationshipField
	}

	return field
}

export const auditRelationshipField = (
	options: AuditFieldsCreateOptions,
	overrides?: OverrideFunction
): RelationshipField => buildAuditRelationshipField(options, overrides)

export const createdByField = (
	options: Partial<AuditFieldsCreateOptions>,
	overrides?: OverrideFunction
): RelationshipField =>
	buildAuditRelationshipField(
		{
			name: 'createdBy',
			label: 'Created By',
			relationTo: 'users',
			...options,
		},
		overrides
	)

export const lastModifiedByField = (
	options: Partial<AuditFieldsCreateOptions>,
	overrides?: OverrideFunction
): RelationshipField =>
	buildAuditRelationshipField(
		{
			name: 'lastModifiedBy',
			label: 'Last Modified By',
			relationTo: 'users',
			...options,
		},
		overrides
	)
