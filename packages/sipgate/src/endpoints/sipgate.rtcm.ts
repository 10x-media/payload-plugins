import { deepMerge, type Endpoint } from 'payload'
import type { SipgateCredentials } from '../types'
import type { SipgateAccess } from '../utils/access'
import { sipgateRtcmHandler } from '../utils/sipgateRtcmHandler'

export const createSipgateRtcm = (
	credentials: SipgateCredentials,
	access?: SipgateAccess,
	overrides?: Partial<Endpoint>
): Endpoint => {
	const defaultEndpoint: Endpoint = {
		path: '/sipgate/rtcm',
		method: 'post',
		handler: sipgateRtcmHandler(credentials, access),
	}
	return deepMerge<Endpoint>(defaultEndpoint, overrides ?? {})
}
