/**
 * Type utilities for working with the `diff` and `snapshot` fields on AuditLog documents.
 *
 * Payload generates these fields as a wide JSON union (`{ [k: string]: unknown } | unknown[] | ...`).
 * These helpers restore type safety without requiring manual type assertions.
 */

// Is T a "relationship" type? Heuristic: NonNullable<T> includes both a primitive (string/number)
// and an object — matching the shape Payload generates: `string | User | null`.
type IsRelationship<T> =
  [Extract<NonNullable<T>, string | number>] extends [never]
    ? false
    : [Extract<NonNullable<T>, object>] extends [never]
      ? false
      : true

// Depth counter — incremented on each recursive call. Stops expansion at 8 levels,
// which prevents runaway instantiation on self-referential Payload types (e.g. relatedArticles).
type _Next = [1, 2, 3, 4, 5, 6, 7, 8, ...never[]]

/**
 * Union of all valid dot-notation diff paths for document type T.
 *
 * - Relationship fields (e.g. `string | User | null`) → leaf path; value is always a raw ID
 * - ID-tracked arrays (items with `id`) → `field.__order__`, `field.{id}`, `field.{id}.subField`
 * - Primitive/non-id arrays → leaf path (whole before/after stored)
 * - Nested plain objects → recursed; both the object path and its leaf paths are included
 * - Index-signature objects (e.g. richText) → leaf path only, no sub-paths
 * - Primitives → leaf path
 */
export type DiffPaths<T, Prefix extends string = '', D extends number = 0> =
  D extends 8
    ? never
    : {
        [K in keyof T & string]-?:
          IsRelationship<T[K]> extends true
            ? `${Prefix}${K}`
            : NonNullable<T[K]> extends Array<infer Item>
              ? Item extends { id: string | number }
                ?
                    | `${Prefix}${K}.__order__`
                    | `${Prefix}${K}.${string}`
                    | DiffPaths<Item, `${Prefix}${K}.${string}.`, _Next[D]>
                : `${Prefix}${K}`
              : NonNullable<T[K]> extends object
                ? string extends keyof NonNullable<T[K]>
                  ? `${Prefix}${K}`
                  : `${Prefix}${K}` | DiffPaths<NonNullable<T[K]>, `${Prefix}${K}.`, _Next[D]>
                : `${Prefix}${K}`
      }[keyof T & string]

/**
 * Resolves the TypeScript type stored at diff path P within document type T.
 *
 * Works for both literal paths (`'title'`) and template literal paths (`'steps.abc123.title'`).
 * Relationship fields resolve to `string | number` (always stored as the raw ID after normalization).
 */
export type DiffPathValue<T, P extends string> =
  P extends `${infer K}.${infer Rest}`
    ? K extends keyof T
      ? NonNullable<T[K]> extends Array<infer Item>
        ? Item extends { id: string | number }
          ? Rest extends '__order__'
            ? (string | number)[]
            : Rest extends `${string}.${infer SubRest}`
              ? DiffPathValue<Item, SubRest>
              : Item | null // whole item path (added / removed)
          : unknown // primitive array — no sub-paths
        : DiffPathValue<NonNullable<T[K]>, Rest>
      : unknown // dynamic segment (array item ID) — caller already narrowed above
    : P extends keyof T
      ? IsRelationship<T[P]> extends true
        ? string | number
        : NonNullable<T[P]>
      : unknown

/** The before/after pair stored for a single changed path in the diff. */
export type DiffEntry<V = unknown> = { before: V | null; after: V | null }

const toRawDiff = (value: unknown): Record<string, { before: unknown; after: unknown }> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, { before: unknown; after: unknown }>)
    : {}

/**
 * Wraps the `diff` field of an AuditLog document and provides type-safe access.
 *
 * The `diff` field is typed as a wide Payload JSON union — this utility restores precise types
 * without casting the whole object.
 *
 * @example
 * const d = typedDiff<Post>(auditLog.diff)
 *
 * d.get('title')                    // DiffEntry<string> | undefined
 * d.get('details.score')            // DiffEntry<number> | undefined
 * d.get('steps.abc123.title')       // DiffEntry<string> | undefined
 * d.get('steps.__order__')          // DiffEntry<(string | number)[]> | undefined
 * d.has('status')                   // boolean
 * d.raw                             // Record<string, { before: unknown; after: unknown }>
 */
export function typedDiff<T>(diff: unknown) {
  const raw = toRawDiff(diff)
  return {
    get<P extends DiffPaths<T>>(path: P): DiffEntry<DiffPathValue<T, P>> | undefined {
      return raw[path as string] as DiffEntry<DiffPathValue<T, P>> | undefined
    },
    has<P extends DiffPaths<T>>(path: P): boolean {
      return (path as string) in raw
    },
    raw,
  }
}

/**
 * Casts the `snapshot` field of an AuditLog document to the collection type T.
 * Returns null if the snapshot is absent or not a plain object.
 *
 * @example
 * const post = typedSnapshot<Post>(auditLog.snapshot)
 * post?.title  // string | undefined
 */
export function typedSnapshot<T>(snapshot: unknown): T | null {
  if (snapshot !== null && typeof snapshot === 'object' && !Array.isArray(snapshot)) {
    return snapshot as T
  }
  return null
}
