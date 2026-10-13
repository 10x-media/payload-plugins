import type { Config } from 'payload'

import { accessEndpoint } from '../endpoints/access'
import { audioEndpoint } from '../endpoints/audio'
import { completeEndpoint } from '../endpoints/complete'
import { listEndpoint } from '../endpoints/list'
import { reserveEndpoint } from '../endpoints/reserve'
import { statusEndpoint } from '../endpoints/status'
import type { ResolvedOptions } from '../types'

export const registerEndpoints = (config: Config, options: ResolvedOptions): void => {
	const base = options.apiPath
	config.endpoints = [
		...(config.endpoints ?? []),
		accessEndpoint(`${base}/access`),
		statusEndpoint(`${base}/status`),
		reserveEndpoint(`${base}/clips`),
		listEndpoint(`${base}/clips`),
		completeEndpoint(`${base}/clips/:id/complete`),
		audioEndpoint(`${base}/clips/:id/audio`),
	]
}
