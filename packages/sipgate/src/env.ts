// biome-ignore-all lint/plugin/noProcessEnv: env boundary
export const env = {
	SIPGATE_TOKEN_ID: process.env.SIPGATE_TOKEN_ID,
	SIPGATE_TOKEN: process.env.SIPGATE_TOKEN,
}
