import type { Payload } from 'payload'

const DEV_EMAIL = 'dev@10xmedia.de'
const DEV_PASSWORD = 'password'

/** Seed the dev Payload app: an admin user plus the color showcase docs. Idempotent. */
export const seedDev = async (payload: Payload): Promise<void> => {
	const userCount = await payload.count({ collection: 'users' })
	if (userCount.totalDocs === 0) {
		await payload.create({
			collection: 'users',
			data: { email: DEV_EMAIL, password: DEV_PASSWORD },
		})
		payload.logger.info(`Seeded dev admin: ${DEV_EMAIL} / ${DEV_PASSWORD}`)
	}

	const tenantCount = await payload.count({ collection: 'tenants' })
	if (tenantCount.totalDocs === 0) {
		await payload.create({
			collection: 'tenants',
			data: {
				name: 'acme',
				brandColors: [
					{ key: 'primary', label: 'Acme primary', value: '#7c3aed' },
					{ key: 'surface', label: 'Acme surface', value: '#f5f3ff' },
				],
			},
		})
		await payload.create({
			collection: 'tenants',
			data: {
				name: 'globex',
				brandColors: [{ key: 'primary', label: 'Globex primary', value: 'oklch(0.65 0.18 250)' }],
			},
		})
		await payload.create({
			collection: 'colors',
			data: {
				title: 'Showcase',
				hexDefault: '#7c3aed',
				hslFormat: 'hsl(262 83% 58%)',
				linkedStatic: 'preset:brand',
				linkedTenant: 'preset:acme/primary',
				noAlpha: '#16a34a',
				oklchFormat: 'oklch(0.62 0.25 29)',
				readOnlyColor: '#334155',
				requiredColor: '#0ea5e9',
				rgbFormat: 'rgb(14 165 233)',
				withPresets: '#0ea5e9',
			},
		})
		payload.logger.info('Seeded color showcase: tenants + colors')
	}
}
