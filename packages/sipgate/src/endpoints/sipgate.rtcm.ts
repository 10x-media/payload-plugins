import { deepMerge, type Endpoint } from 'payload'
import type { SipgateCredentials } from '../types'
import { sipgateRtcmHandler } from '../utils/sipgateRtcmHandler'

export const createSipgateRtcm = (
	credentials: SipgateCredentials,
	overrides?: Partial<Endpoint>
): Endpoint => {
	const defaultEndpoint: Endpoint = {
		path: '/sipgate/rtcm',
		method: 'post',
		handler: sipgateRtcmHandler(credentials),
	}
	return deepMerge<Endpoint>(defaultEndpoint, overrides ?? {})
}
