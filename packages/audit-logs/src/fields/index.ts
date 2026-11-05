import type { RelationshipField } from 'payload'
import type { AuditRelationshipFieldOptions } from '../types'

/** The plugin's read-only relationship component, as the import map knows it. */
export const AUDIT_RELATIONSHIP_FIELD_COMPONENT =
	'@10x-media/audit-logs/client#AuditRelationshipField'

/**
 * A read-only relationship field drawn like the `createdBy` and `updatedBy` fields
 * the plugin shows: the related document as text, or as a link that opens it in a
 * drawer when the viewer may read it. For fields of your own, such as `reviewedBy`;
 * filling it is up to you.
 */
export const auditRelationshipField = ({
	admin,
	label,
	name,
	relationTo,
}: AuditRelationshipFieldOptions): RelationshipField =>
	({
		name,
		type: 'relationship',
		admin: {
			readOnly: true,
			...admin,
			components: {
				Field: AUDIT_RELATIONSHIP_FIELD_COMPONENT,
				...admin?.components,
			},
		},
		hasMany: false,
		...(label !== undefined && { label }),
		relationTo,
	}) as RelationshipField
