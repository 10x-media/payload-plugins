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
		// acme/primary comes from the individual field, not an array row, so the
		// seeded 'preset:acme/primary' ref exercises the presetsFromDoc path
		await payload.create({
			collection: 'tenants',
			data: {
				name: 'acme',
				accent: '#f59e0b',
				brandColors: [{ key: 'surface', label: 'Acme surface', value: '#f5f3ff' }],
				primary: '#7c3aed',
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
				notClearable: '#f59e0b',
				oklchFormat: 'oklch(0.62 0.25 29)',
				readOnlyColor: '#e11d48',
				requiredColor: '#0ea5e9',
				rgbFormat: 'rgb(14 165 233)',
				withPresets: '#0ea5e9',
			},
		})
		payload.logger.info('Seeded color showcase: tenants + colors')
	}
}
