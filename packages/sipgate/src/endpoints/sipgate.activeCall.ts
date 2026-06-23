import { deepMerge, type Endpoint } from 'payload'
import { sipgateActiveCallHandler } from '../utils/sipgateActiveCallHandler'

export const createSipgateActiveCall = (overrides?: Partial<Endpoint>): Endpoint => {
	const defaultEndpoint: Endpoint = {
		path: '/sipgate/active-call',
		method: 'get',
		handler: sipgateActiveCallHandler,
	}
	return deepMerge<Endpoint>(defaultEndpoint, overrides ?? {})
}
