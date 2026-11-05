/**
 * True for Node's module-not-found codes, the only import failures meaning a peer is absent. Any
 * other error comes from inside the resolved peer and must propagate unchanged.
 */
export const isModuleNotFoundError = (err: unknown): boolean => {
	const code = err instanceof Error && 'code' in err ? err.code : undefined
	return code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND'
}
