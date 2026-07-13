import { firstHop } from './clientIp'
import type { IdentifyFn } from './types'

/**
 * Default identity resolution for rate-limiting + upload ownership. Prefers an authenticated user id
 * (trustworthy); else the first hop of the configured trusted IP header (best-effort, proxy-dependent);
 * else null, in which case the caller fails open (cannot fairly rate-limit an unidentifiable client).
 */
export const defaultIdentify =
	(ipHeader: string): IdentifyFn =>
	(req) => {
		const userId = req.user?.id
		if (userId != null) {
			return `user:${String(userId)}`
		}
		const ip = firstHop(req.headers, ipHeader)
		return ip ? `ip:${ip}` : null
	}
