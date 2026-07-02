/**
 * Standard "must be logged in" access guard. Typed structurally so it satisfies both Payload's
 * collection-level `Access` and field-level `FieldAccess`. Shared across all form-builder
 * collections so the pattern is not repeated inline. Candidate for extraction to a shared
 * `config/payload-access` package once more plugins in this monorepo need it.
 */
export const isLoggedIn = ({ req }: { req: { user?: unknown } }): boolean => Boolean(req.user)
