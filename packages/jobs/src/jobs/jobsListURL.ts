import * as qs from 'qs-esm'

import { type JobStatus, statusWhere } from './deriveJobStatus'

/**
 * Admin list URL for the jobs collection, optionally filtered to one derived
 * status. Serialized with qs so the list view's where parser (also qs) reads
 * back the exact clause the health bar counted with.
 */
export const jobsListURL = (adminRoute: string, status?: JobStatus, now?: number): string => {
	const base = `${adminRoute}/collections/payload-jobs`
	if (!status) {
		return base
	}
	return `${base}${qs.stringify({ where: statusWhere(status, now) }, { addQueryPrefix: true })}`
}
