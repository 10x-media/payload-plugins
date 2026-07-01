import { deepMerge, type Endpoint } from 'payload'
import type { SipgateCredentials } from '../types'
import type { SipgateAccess } from '../utils/access'
import { sipgateRtcmHandler } from '../utils/sipgateRtcmHandler'

type CreateSipgateRtcmOptions = {
	credentials: SipgateCredentials
	access?: SipgateAccess
	sipgateUsersSlug?: string
	overrides?: Partial<Endpoint>
}

export const createSipgateRtcm = ({
	credentials,
	access,
	sipgateUsersSlug,
	overrides,
}: CreateSipgateRtcmOptions): Endpoint => {
	const defaultEndpoint: Endpoint = {
		path: '/sipgate/rtcm',
		method: 'post',
		handler: sipgateRtcmHandler({ credentials, access, sipgateUsersSlug }),
	}
	return deepMerge<Endpoint>(defaultEndpoint, overrides ?? {})
}
