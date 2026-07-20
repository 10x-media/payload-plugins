export type ParsedIconValue = { library: null | string; name: string }

/** An empty prefix (`:house`) reads as no library, not as a library named ''. */
export const parseIconValue = (value: string): ParsedIconValue => {
	const separator = value.indexOf(':')
	if (separator === -1) return { library: null, name: value }
	const library = value.slice(0, separator)
	return { library: library === '' ? null : library, name: value.slice(separator + 1) }
}

export const formatIconValue = (library: string, name: string): string => `${library}:${name}`

/** Bare legacy values (no `library:` prefix) read as the default library; stored data is never migrated. */
export const resolveIconValue = (
	value: string,
	defaultLibrary: string
): { library: string; name: string } => {
	const parsed = parseIconValue(value)
	return { library: parsed.library ?? defaultLibrary, name: parsed.name }
}
