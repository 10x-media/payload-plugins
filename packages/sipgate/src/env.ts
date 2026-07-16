// biome-ignore-all lint/plugin/noProcessEnv: env boundary
/**
 * Env fallbacks. Plugin options are the supported configuration path; these are
 * only read when the matching option is absent (PAT credentials and the legacy
 * `SIPGATE_WEBHOOK_URL` used for live-call answer/hangup callbacks).
 */
export const env = {
	SIPGATE_TOKEN_ID: process.env.SIPGATE_TOKEN_ID,
	SIPGATE_TOKEN: process.env.SIPGATE_TOKEN,
	SIPGATE_WEBHOOK_URL: process.env.SIPGATE_WEBHOOK_URL,
}
