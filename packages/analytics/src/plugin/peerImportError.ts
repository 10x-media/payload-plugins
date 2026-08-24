/**
 * True for Node's module-resolution failure codes (ESM `ERR_MODULE_NOT_FOUND`,
 * CJS `MODULE_NOT_FOUND`): the only peer-import failures that mean "the peer
 * isn't installed". Anything else is a real error surfacing from inside the
 * peer module once resolved and must propagate unchanged, not get relabeled
 * as a missing dependency.
 */
export const isModuleNotFoundError = (err: unknown): boolean => {
	const code = err instanceof Error ? (err as NodeJS.ErrnoException).code : undefined
	return code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND'
}
