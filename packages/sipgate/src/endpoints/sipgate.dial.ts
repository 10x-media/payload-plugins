import { deepMerge, type Endpoint } from 'payload'
import type { SipgateCredentials } from '../types'
import { createSipgateDialHandler } from '../utils/sipgateDialHandler'

export const createSipgateDial = (
	credentials: SipgateCredentials,
	overrides?: Partial<Endpoint>
): Endpoint => {
	const defaultEndpoint: Endpoint = {
		path: '/sipgate/dial',
		method: 'post',
		handler: createSipgateDialHandler(credentials),
	}
	return deepMerge<Endpoint>(defaultEndpoint, overrides ?? {})
}
