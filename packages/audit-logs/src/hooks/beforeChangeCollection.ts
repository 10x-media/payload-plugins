import type { CollectionBeforeChangeHook } from 'payload'

import { setAtPath } from '../utilities/setAtPath.js'

export type AuditHookFieldConfig = {
  isPolymorphic: boolean
  path: string
  relationTo: string | string[]
}

export type BeforeChangeAuditFieldOptions = {
  createdBy?: AuditHookFieldConfig | false
  lastModifiedBy?: AuditHookFieldConfig | false
}

const buildUserValue = (
  config: AuditHookFieldConfig,
  userId: unknown,
  userCollection: string,
): unknown => {
  if (config.isPolymorphic) {
    return { relationTo: userCollection, value: userId }
  }
  return userId
}

const isUserAllowed = (config: AuditHookFieldConfig, userCollection: string): boolean => {
  const allowed = Array.isArray(config.relationTo) ? config.relationTo : [config.relationTo]
  return allowed.includes(userCollection)
}

export const beforeChangeCollectionAuditField =
  (options: BeforeChangeAuditFieldOptions): CollectionBeforeChangeHook =>
  (args) => {
    if (!args.req.user) {
      return args.data
    }

    const { id, collection } = args.req.user

    if (args.operation === 'create' && options.createdBy && isUserAllowed(options.createdBy, collection)) {
      setAtPath(
        args.data as Record<string, unknown>,
        options.createdBy.path,
        buildUserValue(options.createdBy, id, collection),
      )
    }

    if (options.lastModifiedBy && isUserAllowed(options.lastModifiedBy, collection)) {
      setAtPath(
        args.data as Record<string, unknown>,
        options.lastModifiedBy.path,
        buildUserValue(options.lastModifiedBy, id, collection),
      )
    }

    return args.data
  }
