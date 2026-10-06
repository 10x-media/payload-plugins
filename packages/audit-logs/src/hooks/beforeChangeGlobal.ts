import type { GlobalBeforeChangeHook } from 'payload'
import { getAtPath, setAtPath } from '../utilities/setAtPath'
import type { AuditHookFieldConfig, BeforeChangeAuditFieldOptions } from './beforeChangeCollection'

const resolveUserValue = (
	config: AuditHookFieldConfig,
	userId: unknown,
	userCollection: string
): unknown => {
	if (config.isPolymorphic) {
		return { relationTo: userCollection, value: userId }
	}
	return userId
}

export const beforeChangeGlobalAuditField =
	(options: BeforeChangeAuditFieldOptions): GlobalBeforeChangeHook =>
	(args) => {
		if (!args.req.user) {
			return args.data
		}

		if (options.createdBy) {
			const originalDoc = args.originalDoc as Record<string, unknown> | undefined
			const isCreatedByEmpty = !originalDoc || !getAtPath(originalDoc, options.createdBy.path)

			if (isCreatedByEmpty) {
				setAtPath(
					args.data as Record<string, unknown>,
					options.createdBy.path,
					resolveUserValue(options.createdBy, args.req.user.id, args.req.user.collection)
				)
			}
		}

		if (options.lastModifiedBy) {
			setAtPath(
				args.data as Record<string, unknown>,
				options.lastModifiedBy.path,
				resolveUserValue(options.lastModifiedBy, args.req.user.id, args.req.user.collection)
			)
		}

		return args.data
	}
