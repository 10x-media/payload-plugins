/** First hop of a comma-separated proxy header (the client, per X-Forwarded-For convention), or undefined. */
export const firstHop = (headers: Headers | undefined, header: string): string | undefined => {
	const first = headers?.get(header)?.split(',')[0]?.trim()
	return first || undefined
}
