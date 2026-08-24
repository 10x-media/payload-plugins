import type { CollectionSlug } from 'payload'

/**
 * Every collection this plugin reads or writes is named by a runtime option, so its slug is a
 * plain string here. `CollectionSlug` narrows to a literal union of the host's own collections
 * wherever generated types are in scope, which a plugin can never satisfy: it does not know what
 * the consumer configured, and the slug it was handed is correct by construction.
 *
 * The cast lives behind one named function rather than being repeated at every call site, so the
 * reason is stated once and a reader is not left wondering whether some particular `as` was
 * papering over a real mismatch.
 */
export const asSlug = (slug: string): CollectionSlug => slug as CollectionSlug

/**
 * A document read from one of those collections. Payload resolves the return type from the slug,
 * which is opaque here for the same reason, so the shape a caller relies on is asserted rather
 * than inferred. Callers narrow the fields they actually touch.
 */
export const asRow = <T>(doc: unknown): T => doc as T
