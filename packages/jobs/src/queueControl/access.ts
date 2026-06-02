import type { PayloadRequest } from 'payload'

/** A jobs access checker (matches Payload's `jobs.access.run` shape). */
export type JobAccess = (args: { req: PayloadRequest }) => boolean | Promise<boolean>

export type CronSecretAccessOptions = {
	/** Env var holding the shared secret. Default `CRON_SECRET`. */
	envVar?: string
}

/** The default endpoint guard: logged-in users only (safer than Payload's open default). */
export const loggedInAccess: JobAccess = ({ req }) => Boolean(req.user)

/**
 * An access checker for serverless cron triggers: a logged-in user passes, otherwise
 * the request must carry `Authorization: Bearer ${process.env[envVar]}`. Payload ships
 * no built-in secret check, so this implements the canonical Vercel-cron pattern.
 */
export const cronSecretAccess = (options: CronSecretAccessOptions = {}): JobAccess => {
	const envVar = options.envVar ?? 'CRON_SECRET'
	return ({ req }) => {
		if (req.user) {
			return true
		}
		// biome-ignore lint/plugin/noProcessEnv: reads the operator-provided cron secret at request time
		const secret = process.env[envVar]
		if (!secret) {
			return false
		}
		return req.headers.get('authorization') === `Bearer ${secret}`
	}
}
