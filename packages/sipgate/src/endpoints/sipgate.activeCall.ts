import { deepMerge, type Endpoint } from 'payload'
import type { SipgateAccess } from '../utils/access'
import { sipgateActiveCallHandler } from '../utils/sipgateActiveCallHandler'

export const createSipgateActiveCall = (
	access?: SipgateAccess,
	overrides?: Partial<Endpoint>,
	sipgateUsersSlug?: string
): Endpoint => {
	const defaultEndpoint: Endpoint = {
		path: '/sipgate/active-call',
		method: 'get',
		handler: sipgateActiveCallHandler(access, sipgateUsersSlug),
	}
	return deepMerge<Endpoint>(defaultEndpoint, overrides ?? {})
}
