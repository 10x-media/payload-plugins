/**
 * Helpers with no server dependency: the lock rejection and its guard, so client code can tell a
 * content lock from any other failed write. The root is the server plugin.
 */
export {
	CONTENT_LOCKED_ERROR_NAME,
	ContentLockedError,
	type ContentLockedErrorData,
	isContentLockedError,
} from '../enforcement/ContentLockedError'
