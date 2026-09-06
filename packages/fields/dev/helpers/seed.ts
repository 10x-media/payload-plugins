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

	const measurementCount = await payload.count({ collection: 'measurements' })
	if (measurementCount.totalDocs === 0) {
		await payload.create({
			collection: 'measurements',
			data: {
				title: 'Showcase',
				boundedWeight: 95.5,
				cutout: 508,
				distance: 42.195,
				height: 180.34,
				kgOnly: 70,
				labSample: 12.345678,
				load: 20,
				localizedDistance: 5,
				poundsFirst: 81.646627,
				readOnlyWeight: 81.646627,
				sailing: 18.52,
				shippingWeight: 3400.7,
				speed: 37.5,
				temperature: 36.6,
				volume: 0.75,
				weight: 81.646627,
				wingspan: 183,
			},
		})
		payload.logger.info('Seeded measurement showcase document')
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

	const storiesCount = await payload.count({ collection: 'write-only-stories' })
	if (storiesCount.totalDocs === 0) {
		// Every credential set, so each story's SET state renders: hint or dots
		// placeholder plus the inline actions. Values are realistic shapes (the
		// stripe key deliberately avoids the sk_live_ pattern, which GitHub push
		// protection blocks even as a fixture) so hints like sk_d····9d3f render.
		await payload.create({
			collection: 'write-only-stories',
			data: {
				dbPassword: 'correct-horse-battery-staple',
				label: 'Acme integrations (all credentials set)',
				rotationSecret: 'rot_5f8a2b9c1d4e7f0a3b6c9d2e5f8a1b4c',
				smtpPassword: 'smtp-P@ssw0rd-from-provider',
				stripeKey: 'sk_demo_a1b2c3d4e5f6a7b8c9d0e1f2a3b49d3f',
				tenantApiKey: 'tnnt_9f3e2d1c0b4a5968a7b6c5d4e3f29d3f',
				webhookSecret: 'whsec_0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d',
			},
		})
		// Everything unset except the required rotation secret (a required field
		// cannot exist unset), so each optional story's UNSET state renders: the
		// plain native input, no dots, no actions, an em dash in the list cell.
		await payload.create({
			collection: 'write-only-stories',
			data: {
				label: 'Fresh tenant (nothing configured yet)',
				rotationSecret: 'rot_fresh0b4a5968a7b6c5d4e3f2571c',
			},
		})
		payload.logger.info('Seeded write-only user-story showcase')
	}
}
