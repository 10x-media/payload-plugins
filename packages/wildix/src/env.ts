// biome-ignore-all lint/plugin/noProcessEnv: env boundary
export const env = {
	WILDIX_PBX_HOST: process.env.WILDIX_PBX_HOST,
	WILDIX_PBX_PORT: process.env.WILDIX_PBX_PORT,
	WILDIX_API_KEY: process.env.WILDIX_API_KEY,
	WILDIX_CLIENT_ID: process.env.WILDIX_CLIENT_ID,
	WILDIX_CLIENT_SECRET: process.env.WILDIX_CLIENT_SECRET,
	WILDIX_COMPANY: process.env.WILDIX_COMPANY,
	WILDIX_WEBHOOK_SECRET: process.env.WILDIX_WEBHOOK_SECRET,
}
