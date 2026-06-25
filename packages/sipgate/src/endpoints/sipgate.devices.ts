import { deepMerge, type Endpoint } from 'payload'
import { probeDevices } from '../utils/sipgate.rest'

export const createSipgateDevices = (
	maxDeviceProbeCount: number,
	overrides?: Partial<Endpoint>
): Endpoint => {
	const defaultEndpoint: Endpoint = {
		path: '/sipgate/devices',
		method: 'get',
		handler: async () => {
			const devices = await probeDevices(maxDeviceProbeCount)
			return Response.json(devices)
		},
	}
	return deepMerge<Endpoint>(defaultEndpoint, overrides ?? {})
}
