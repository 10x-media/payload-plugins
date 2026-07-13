// biome-ignore-all lint/plugin/noProcessEnv: dev app env boundary

import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { nodemailerAdapter } from '@payloadcms/email-nodemailer'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildConfig, type CollectionConfig } from 'payload'
import { defineCaptchaProvider, defineFormField, type FieldTypeOption, formBuilder } from '../src/index'
import { forwardAction } from './helpers/actions'
import { startMemoryMongo } from './helpers/memoryDb'
import { customRules } from './helpers/rules'
import { seedDev } from './helpers/seed'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const migrationDir = path.resolve(dirname, 'migrations')
const useDb = process.env.DEV_DB === 'postgres' ? 'postgres' : 'mongo'
const autoGenerate = process.env.PAYLOAD_SKIP_AUTOGEN !== '1'

const users: CollectionConfig = {
	slug: 'users',
	auth: true,
	admin: { useAsTitle: 'email' },
	fields: [],
}

const db =
	useDb === 'postgres'
		? postgresAdapter({
				migrationDir,
				pool: {
					connectionString:
						process.env.DATABASE_URI_POSTGRES ??
						'postgres://e2e:e2e@localhost:35432/form-builder_e2e',
				},
			})
		: mongooseAdapter({
				ensureIndexes: true,
				migrationDir,
				url: process.env.DATABASE_URI_MONGO ?? (await startMemoryMongo()),
			})

export default buildConfig({
	secret: process.env.PAYLOAD_SECRET ?? 'dev-secret-not-for-prod',
	db,
	collections: [users],
	plugins: [
		formBuilder({
			fields: {
				date: defineFormField<'date'>({
					type: 'date',
					label: 'Date',
					value: 'date',
					validate: ({ value }) =>
						value != null && isNaN(Date.parse(String(value))) ? 'Invalid date' : true,
					format: ({ value }) => (value ? new Date(String(value)).toLocaleDateString() : ''),
				}) as FieldTypeOption,
			},
			rules: {
				dateMin: customRules[0]!,
				dateMax: customRules[1]!,
			},
			actions: {
				forward: forwardAction,
			},
			spam: {
				captcha: defineCaptchaProvider({
					type: 'turnstile',
					verify: async ({ token }) => {
						const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({
								secret: process.env.TURNSTILE_SECRET ?? '',
								response: token,
							}),
						})
						return ((await res.json()) as { success: boolean }).success
					},
				}),
			},
		}),
	],
	telemetry: false,
	onInit: async (payload) => {
		await seedDev(payload)
	},
	typescript: { autoGenerate },
	admin: {
		importMap: {
			autoGenerate,
			baseDir: path.resolve(dirname),
		},
	},
	email: nodemailerAdapter({
		defaultFromAddress: process.env.SMTP_FROM_ADDRESS ?? 'test@test.com',
		defaultFromName: process.env.SMTP_FROM_NAME ?? 'Tester',
		transportOptions: {
			host: process.env.SMTP_HOST ?? 'smtp.gmail.com',
			port: Number(process.env.SMTP_PORT) || 465,
			auth: {
				user: process.env.SMTP_USER ?? 'test@gmail.com',
				pass: process.env.SMTP_PASS ?? '',
			},
		},
	}),
})
