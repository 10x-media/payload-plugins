/**
 * Identifies the signed-in reader across the server and client halves of the provider, so the
 * client can tell when the rail it holds was computed for somebody else. `null` when nobody is.
 */
export const readerKey = (
	user: { collection?: string; id: number | string } | null | undefined
): null | string => (user ? `${user.collection ?? ''}:${user.id}` : null)
