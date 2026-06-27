import { deepMerge, type Endpoint } from 'payload'
import type { SipgateAccess } from '../utils/access'
import { sipgateActiveCallHandler } from '../utils/sipgateActiveCallHandler'

export const createSipgateActiveCall = (
	access?: SipgateAccess,
	overrides?: Partial<Endpoint>
): Endpoint => {
	const defaultEndpoint: Endpoint = {
		path: '/sipgate/active-call',
		method: 'get',
		handler: sipgateActiveCallHandler(access),
	}
	return deepMerge<Endpoint>(defaultEndpoint, overrides ?? {})
}
