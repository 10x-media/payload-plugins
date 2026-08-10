import type { Payload } from 'payload'

const DEV_EMAIL = 'dev@10xmedia.de'
const DEV_PASSWORD = 'password'

/** Seed the dev Payload app: an admin user plus the color and icon showcase docs. Idempotent. */
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
				brandColors: [
					{ key: 'surface', label: 'Acme surface', value: '#f5f3ff', valueDark: '#1e1b4b' },
				],
				enabledLibraries: ['lucide', 'radix'],
				primary: '#7c3aed',
			},
		})
		await payload.create({
			collection: 'tenants',
			data: {
				name: 'globex',
				brandColors: [{ key: 'primary', label: 'Globex primary', value: 'oklch(0.65 0.18 250)' }],
				enabledLibraries: ['tabler'],
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

	const iconCount = await payload.count({ collection: 'icons' })
	if (iconCount.totalDocs === 0) {
		const tenantDocs = await payload.find({ collection: 'tenants', limit: 100 })
		const acme = tenantDocs.docs.find((doc) => doc.name === 'acme')
		const globex = tenantDocs.docs.find((doc) => doc.name === 'globex')
		if (acme && globex) {
			// acme enables lucide+radix, so Tenant-scoped shows a switcher for those
			// two and its stored lucide value renders normally.
			await payload.create({
				collection: 'icons',
				data: {
					iconMulti: 'radix:cube',
					iconRequired: 'lucide:anchor',
					iconSingle: 'lucide:house',
					iconTenantRestricted: 'lucide:heart',
					iconWithForced: 'social:youtube',
					iconWithText: 'tabler:heart',
					tenant: acme.id,
					title: 'Acme (multi-library tenant)',
				},
			})
			// globex enables only tabler, so Tenant-scoped hides the switcher, and the
			// stored lucide value is from a disabled library and demonstrates graceful
			// degradation. iconMulti uses a bare legacy name that reads as the default
			// library (lucide).
			await payload.create({
				collection: 'icons',
				data: {
					iconMulti: 'house',
					iconRequired: 'tabler:heart',
					iconTenantRestricted: 'lucide:star',
					iconWithForced: 'social:instagram',
					iconWithText: 'tabler:star',
					tenant: globex.id,
					title: 'Globex (single-library + degradation)',
				},
			})
			payload.logger.info('Seeded icon showcase')
		}
	}

	const encryptedCount = await payload.count({ collection: 'encrypted' })
	if (encryptedCount.totalDocs === 0) {
		await payload.create({
			collection: 'encrypted',
			data: {
				apiKey: '0123456789abcdef0123456789abcdef',
				apiSnippet: "const token = 'redacted'",
				birthday: '1990-05-15T00:00:00.000Z',
				channels: ['email', 'push'],
				contactEmail: 'jane.doe@example.com',
				draftBody: {
					root: {
						children: [
							{
								children: [
									{
										text: 'Draft body, protection none, encrypted at rest.',
										type: 'text',
										version: 1,
									},
								],
								direction: null,
								format: '',
								indent: 0,
								type: 'paragraph',
								version: 1,
							},
						],
						direction: null,
						format: '',
						indent: 0,
						type: 'root',
						version: 1,
					},
				},
				fullName: 'Jane Doe',
				isVip: true,
				label: 'Jane Doe (seeded)',
				lastKnownLocation: [13.405, 52.52],
				metadata: { clearance: 'level-3', tags: ['pii'] },
				notes: 'Visible input, encrypted at rest. Check the DB to verify.',
				privateNotes: {
					root: {
						children: [
							{
								children: [{ text: 'Extremely private rich text.', type: 'text', version: 1 }],
								direction: null,
								format: '',
								indent: 0,
								type: 'paragraph',
								version: 1,
							},
						],
						direction: null,
						format: '',
						indent: 0,
						type: 'root',
						version: 1,
					},
				},
				referral: 'friend',
				salary: 98765.43,
				tier: 'pro',
			},
		})
		payload.logger.info('Seeded encrypted showcase document')
	}
}
