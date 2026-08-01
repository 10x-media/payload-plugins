import type { StaticLabel } from 'payload'

/**
 * Resolves a StaticLabel to a plain string for the requested language. Adapter
 * and library-option labels reach the client as strings, so they must be
 * flattened server-side. Done here rather than via `@payloadcms/translations`
 * because this package does not depend on it (same reason colorField resolves
 * its own labels).
 */
export const resolveStaticLabel = (
	label: StaticLabel | undefined,
	language: string
): string | undefined => {
	if (label === undefined || typeof label === 'string') return label
	return label[language] ?? label.en ?? Object.values(label)[0]
}
