import type { PayloadRequest } from 'payload'

export type WildixAccessFn = (req: PayloadRequest) => boolean | Promise<boolean>

export type WildixAccess = {
	default?: WildixAccessFn
	dial?: WildixAccessFn
	rtcm?: WildixAccessFn
	activeCall?: WildixAccessFn
	devices?: WildixAccessFn
	contacts?: WildixAccessFn
	sync?: WildixAccessFn
}

const defaultAccessFn: WildixAccessFn = (req) => req.user != null

export const checkAccess = async (
	req: PayloadRequest,
	access: WildixAccess | undefined,
	endpoint: keyof Omit<WildixAccess, 'default'>
): Promise<Response | null> => {
	const fn = access?.[endpoint] ?? access?.default ?? defaultAccessFn
	const allowed = await fn(req)
	if (!allowed) {
		return Response.json({ error: 'Unauthorized' }, { status: 401 })
	}
	return null
}
