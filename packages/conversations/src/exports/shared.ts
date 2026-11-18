/**
 * Helpers with no server and no React dependency: key formats and their parsers, the message
 * cursor and the time formatters. A host module that both server code and client components
 * import reads them from here; the root is the server plugin and `./react` is a client entry.
 */

export { absoluteTime, dayKey, relativeTime } from '../react/time'
export { formatCursor } from '../shared/cursor'
export {
	collectionKey,
	customKey,
	globalKey,
	type ParsedKey,
	parseKey,
	parseSystemKey,
	parseUserKey,
	SYSTEM_AUTHOR,
	systemKey,
	type TargetKind,
	type UserRef,
	userKey,
} from '../shared/keys'
