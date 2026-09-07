/**
 * The originating client IP a proxy chain reported: the first hop of
 * `x-forwarded-for`, else `x-real-ip`. Null when the request carries neither, so
 * callers can omit the value instead of forwarding a fabricated one.
 */
export const clientIpFromHeaders = (headers: Headers): string | null => {
	const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim()
	if (forwarded) {
		return forwarded
	}
	return headers.get('x-real-ip')?.trim() || null
}
