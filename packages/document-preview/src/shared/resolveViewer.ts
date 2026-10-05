/** Viewers keyed by mime pattern: an exact mime (`video/mp4`) or a type wildcard (`video/*`). */
export type ViewerMap<T> = { [mimePattern: string]: T }

const MIME_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/(\*|[a-z0-9][a-z0-9!#$&^_.+-]*)$/

/** Whether `pattern` is a valid viewer key: `type/subtype` or `type/*`, lowercase. */
export const isMimePattern = (pattern: string): boolean => MIME_PATTERN.test(pattern)

/** The entry for `mime` in one map: the exact mime first, then its `type/*` wildcard. */
export const matchViewer = <T>(map: undefined | ViewerMap<T>, mime: string): T | undefined => {
	if (!map || !mime) {
		return undefined
	}
	const exact = map[mime]
	if (exact !== undefined) {
		return exact
	}
	const slash = mime.indexOf('/')
	return slash === -1 ? undefined : map[`${mime.slice(0, slash)}/*`]
}

/**
 * The first viewer any layer has for `mime`, layers in priority order (collection
 * overrides, global overrides, built-in defaults). Each layer is searched in full
 * before the next, so a host `video/*` beats a built-in exact `video/mp4`.
 */
export const resolveViewer = <T>(
	layers: ReadonlyArray<undefined | ViewerMap<T>>,
	mime: string
): T | undefined => {
	for (const layer of layers) {
		const match = matchViewer(layer, mime)
		if (match !== undefined) {
			return match
		}
	}
	return undefined
}
