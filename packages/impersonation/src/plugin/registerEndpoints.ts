import type { Config } from 'payload'

import { currentEndpoint } from '../endpoints/current'
import { exitEndpoint } from '../endpoints/exit'
import { startEndpoint } from '../endpoints/start'
import { terminateEndpoint } from '../endpoints/terminate'
import type { ResolvedOptions } from '../types'

export const registerEndpoints = (config: Config, options: ResolvedOptions): void => {
	const base = options.apiPath.endsWith('/') ? options.apiPath.slice(0, -1) : options.apiPath
	config.endpoints = [
		...(config.endpoints ?? []),
		startEndpoint(`${base}/start`),
		exitEndpoint(`${base}/exit`),
		currentEndpoint(base),
		terminateEndpoint(`${base}/:id/end`),
	]
}
