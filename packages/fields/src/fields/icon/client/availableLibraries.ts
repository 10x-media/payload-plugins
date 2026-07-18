export type LibraryOption = { label: string; slug: string }

/**
 * Libraries offered for selection: the registered adapters intersected with the
 * `available` slugs the server resolved for this request. Selection is restricted to
 * these; rendering a stored value still works through any registered adapter.
 */
export const filterAvailableLibraries = (
	adapters: LibraryOption[],
	available: string[]
): LibraryOption[] => {
	const allowed = new Set(available)
	return adapters.filter((adapter) => allowed.has(adapter.slug))
}

/**
 * Library the drawer opens on: the stored value's library when it is still available,
 * otherwise the configured default when available, otherwise the first available
 * library. Never opens on a library the editor cannot pick from.
 */
export const pickInitialLibrary = (args: {
	available: string[]
	defaultLibrary: string
	selectedLibrary: null | string
}): string => {
	const { available, defaultLibrary, selectedLibrary } = args
	if (selectedLibrary !== null && available.includes(selectedLibrary)) return selectedLibrary
	if (available.includes(defaultLibrary)) return defaultLibrary
	return available[0] ?? defaultLibrary
}
