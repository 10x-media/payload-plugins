import type { PayloadRequest } from 'payload'
import type { AnalyticsRuntime } from '../plugin/runtime'
import { isAdminUser } from './adminUser'
import { decideOnce } from './decideOnce'

/**
 * `access.read`, asked once per request; every read passes it where scope and sources resolve, so
 * endpoints, widgets and display fields share one gate. Without `readAccess`, admin users pass.
 */
export const readGate = (runtime: AnalyticsRuntime, req: PayloadRequest): Promise<boolean> =>
	decideOnce(req, {
		owner: runtime,
		key: 'read',
		decide: () => (runtime.readAccess ? runtime.readAccess({ req }) : isAdminUser({ req })),
	})
