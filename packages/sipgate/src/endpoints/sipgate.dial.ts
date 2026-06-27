import { deepMerge, type Endpoint } from 'payload'
import type { SipgateCredentials } from '../types'
import type { SipgateAccess } from '../utils/access'
import { createSipgateDialHandler } from '../utils/sipgateDialHandler'

type CreateSipgateDialOptions = {
	credentials: SipgateCredentials
	access?: SipgateAccess
	singleUserEmail?: string
	sipgateUsersSlug?: string
	overrides?: Partial<Endpoint>
}

export const createSipgateDial = ({
	credentials,
	access,
	singleUserEmail,
	sipgateUsersSlug,
	overrides,
}: CreateSipgateDialOptions): Endpoint => {
	const defaultEndpoint: Endpoint = {
		path: '/sipgate/dial',
		method: 'post',
		handler: createSipgateDialHandler({ credentials, access, singleUserEmail, sipgateUsersSlug }),
	}
	return deepMerge<Endpoint>(defaultEndpoint, overrides ?? {})
}
