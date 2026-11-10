type ID = number | string

/** Where the folder tab is: the URL state Payload's hierarchy view keeps in the address bar. */
export type BrowseState = {
	parentId: ID | null
	search: string
	/** Comma-separated collection slugs, as the view's Type filter writes it. */
	typeFilter?: string
}

export const rootState: BrowseState = { parentId: null, search: '' }

/** Reads a URL the hierarchy view pushed (`?<parentField>=<id>&search=&typeFilter=`). */
export const browseStateFromURL = (url: URL, parentFieldName: string): BrowseState => {
	const parent = url.searchParams.get(parentFieldName)
	const typeFilter = url.searchParams.get('typeFilter')
	return {
		parentId: parent && parent !== 'null' ? parent : null,
		search: url.searchParams.get('search') ?? '',
		...(typeFilter ? { typeFilter } : {}),
	}
}

/** The `useSearchParams()` the hosted view reads back. */
export const browseStateToParams = (
	state: BrowseState,
	parentFieldName: string
): URLSearchParams => {
	const params = new URLSearchParams()
	if (state.parentId !== null) {
		params.set(parentFieldName, String(state.parentId))
	}
	if (state.search) {
		params.set('search', state.search)
	}
	if (state.typeFilter) {
		params.set('typeFilter', state.typeFilter)
	}
	return params
}
