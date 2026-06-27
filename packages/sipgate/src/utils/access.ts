import type { PayloadRequest } from 'payload'

export type SipgateAccessFn = (req: PayloadRequest) => boolean | Promise<boolean>

export type SipgateAccess = {
	default?: SipgateAccessFn
	dial?: SipgateAccessFn
	rtcm?: SipgateAccessFn
	activeCall?: SipgateAccessFn
	devices?: SipgateAccessFn
	contacts?: SipgateAccessFn
	sync?: SipgateAccessFn
}

const defaultAccessFn: SipgateAccessFn = (req) => req.user != null

export const checkAccess = async (
	req: PayloadRequest,
	access: SipgateAccess | undefined,
	endpoint: keyof Omit<SipgateAccess, 'default'>
): Promise<Response | null> => {
	const fn = access?.[endpoint] ?? access?.default ?? defaultAccessFn
	const allowed = await fn(req)
	if (!allowed) {
		return Response.json({ error: 'Unauthorized' }, { status: 401 })
	}
	return null
}
