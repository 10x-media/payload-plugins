import type { PayloadRequest } from 'payload'

export const getClientIP = (req: PayloadRequest): string | undefined => {
	const forwarded = req.headers.get('x-forwarded-for')

	if (forwarded) return (forwarded.split(',')[0] ?? '').trim()

	return req.headers.get('x-real-ip') ?? undefined
}

export const getUserAgent = (req: PayloadRequest): string | undefined =>
	req.headers.get('user-agent') ?? undefined
