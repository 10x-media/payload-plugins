// biome-ignore-all lint/plugin/noProcessEnv: env boundary
export const env = {
	SIPGATE_TOKEN_ID: process.env.SIPGATE_TOKEN_ID,
	SIPGATE_TOKEN: process.env.SIPGATE_TOKEN,
	SIPGATE_DEVICE_ID: process.env.SIPGATE_DEVICE_ID,
	SIPGATE_CHANNEL_ID: process.env.SIPGATE_CHANNEL_ID,
	SIPGATE_CALLER_ID: process.env.SIPGATE_CALLER_ID,
	SIPGATE_WEBHOOK_URL: process.env.SIPGATE_WEBHOOK_URL,
}
