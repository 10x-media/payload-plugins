/** Who is signed in, as one comparable string, or null. Same on the server and in the browser. */
export const userKey = (
	user: { collection?: unknown; id?: unknown } | null | undefined
): string | null =>
	user && user.id !== undefined && user.id !== null
		? `${String(user.collection ?? '')}:${String(user.id)}`
		: null
