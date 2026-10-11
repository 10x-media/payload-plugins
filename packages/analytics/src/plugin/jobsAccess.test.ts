import type { Access, CollectionConfig, Config, Payload, PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { isAdminUser } from '../access/adminUser'
import { JOB_STATS_GLOBAL, narrowStatsGlobal, restrictJobControls } from './jobsAccess'

const task = (slug: string) => ({ slug, handler: async () => ({ output: {} }) })

const configWith = (jobs: Config['jobs']): Config =>
	({ collections: [], jobs }) as unknown as Config

const defaultJobsCollection: CollectionConfig = { slug: 'payload-jobs', fields: [] }

const reqOf = (collection: string): { req: PayloadRequest } => ({
	req: {
		payload: { config: { admin: { user: 'users' } } },
		user: { id: 1, collection },
	} as unknown as PayloadRequest,
})

const payloadWith = (globalAccess: { read: Access; update: Access }) => {
	const warn = vi.fn()
	const payload = {
		config: {
			admin: { user: 'users' },
			jobs: { tasks: [task('analytics-maintain')] },
			globals: [{ slug: JOB_STATS_GLOBAL, access: { ...globalAccess } }],
		},
		logger: { warn },
	} as unknown as Payload
	return { payload, warn }
}

const statsAccess = (payload: Payload) => {
	const global = payload.config.globals.find((each) => each.slug === JOB_STATS_GLOBAL)
	if (!global) {
		throw new Error('no stats global')
	}
	return global.access
}

describe('restrictJobControls', () => {
	it('leaves a config alone when the plugin registered none of its tasks', () => {
		const hostOnly = configWith({ tasks: [task('send-email')] })
		restrictJobControls(hostOnly)
		expect(hostOnly.jobs?.access).toBeUndefined()
		expect(hostOnly.jobs?.jobsCollectionOverrides).toBeUndefined()
		expect(hostOnly.onInit).toBeUndefined()
		const none = configWith(undefined)
		restrictJobControls(none)
		expect(none.jobs).toBeUndefined()
	})

	it('admits the admin collection only to every control the host left unset', () => {
		const config = configWith({ tasks: [task('analytics-maintain')] })
		restrictJobControls(config)
		expect(config.jobs?.access).toEqual({
			run: isAdminUser,
			queue: isAdminUser,
			cancel: isAdminUser,
		})
		const collection = config.jobs?.jobsCollectionOverrides?.({ defaultJobsCollection })
		expect(collection?.access).toEqual({
			create: isAdminUser,
			read: isAdminUser,
			update: isAdminUser,
			delete: isAdminUser,
		})
	})

	it('keeps what the host set, its own overrides included, and composes over them', () => {
		const run = () => true
		const read = () => true
		const config = configWith({
			tasks: [task('analytics-sync')],
			access: { run },
			jobsCollectionOverrides: ({ defaultJobsCollection: base }) => ({
				...base,
				admin: { hidden: false },
				access: { read },
			}),
		})
		restrictJobControls(config)
		expect(config.jobs?.access).toEqual({ run, queue: isAdminUser, cancel: isAdminUser })
		const collection = config.jobs?.jobsCollectionOverrides?.({ defaultJobsCollection })
		expect(collection?.admin).toEqual({ hidden: false })
		expect(collection?.access).toEqual({
			read,
			create: isAdminUser,
			update: isAdminUser,
			delete: isAdminUser,
		})
	})

	it('leaves a collection whose every operation Payload already denies as it is', () => {
		const deny = () => false
		const config = configWith({ tasks: [task('analytics-warm')] })
		restrictJobControls(config)
		const locked = {
			...defaultJobsCollection,
			access: { create: deny, read: deny, update: deny, delete: deny },
		}
		expect(
			config.jobs?.jobsCollectionOverrides?.({ defaultJobsCollection: locked }).access
		).toEqual(locked.access)
	})

	it('narrows the stats global at init, once, and says what it restricted', async () => {
		const hostInit = vi.fn()
		const config = { ...configWith({ tasks: [task('analytics-maintain')] }), onInit: hostInit }
		restrictJobControls(config)
		config.jobs?.jobsCollectionOverrides?.({ defaultJobsCollection })
		const { payload, warn } = payloadWith({ read: () => true, update: () => true })
		await config.onInit?.(payload)
		await config.onInit?.(payload)
		expect(hostInit).toHaveBeenCalledWith(payload)
		const access = statsAccess(payload)
		expect(await access.read(reqOf('customers'))).toBe(false)
		expect(await access.update(reqOf('customers'))).toBe(false)
		expect(await access.read(reqOf('users'))).toBe(true)
		expect(await access.update(reqOf('users'))).toBe(true)
		expect(warn).toHaveBeenCalledTimes(1)
		expect(warn.mock.calls[0]?.[0]).toBe(
			"analytics: Payload's job controls the config left unset now admit users of the \"users\" collection only: jobs.access.run, queue and cancel; the payload-jobs collection's create, read, update and delete; the payload-jobs-stats global's read and update. Set jobs.access, and access in jobs.jobsCollectionOverrides, in your Payload config to choose who may run, queue, cancel and read jobs."
		)
	})

	it('still narrows the stats global while next build collects page data, without a word', async () => {
		vi.stubEnv('NEXT_PHASE', 'phase-production-build')
		try {
			const config = configWith({ tasks: [task('analytics-maintain')] })
			restrictJobControls(config)
			config.jobs?.jobsCollectionOverrides?.({ defaultJobsCollection })
			const { payload, warn } = payloadWith({ read: () => true, update: () => true })
			await config.onInit?.(payload)
			expect(await statsAccess(payload).read(reqOf('customers'))).toBe(false)
			expect(warn).not.toHaveBeenCalled()
		} finally {
			vi.unstubAllEnvs()
		}
	})

	it('never widens the stats global past what it allowed, and says nothing once the host set every control', async () => {
		const deny = () => false
		const config = configWith({
			tasks: [task('analytics-maintain')],
			access: { run: deny, queue: deny, cancel: deny },
			jobsCollectionOverrides: ({ defaultJobsCollection: base }) => ({
				...base,
				access: { create: deny, read: deny, update: deny, delete: deny },
			}),
		})
		restrictJobControls(config)
		config.jobs?.jobsCollectionOverrides?.({ defaultJobsCollection })
		const { payload, warn } = payloadWith({ read: deny, update: deny })
		await config.onInit?.(payload)
		expect(await statsAccess(payload).read(reqOf('users'))).toBe(false)
		expect(warn).not.toHaveBeenCalled()
	})
})

describe('narrowStatsGlobal', () => {
	it('narrows the stats global of a config a reload swapped in, once', async () => {
		const { payload } = payloadWith({ read: () => true, update: () => true })
		expect(narrowStatsGlobal(payload)).toBe(true)
		expect(narrowStatsGlobal(payload)).toBe(false)
		const reloaded = payloadWith({ read: () => true, update: () => true }).payload.config
		Reflect.set(payload, 'config', reloaded)
		expect(await statsAccess(payload).read?.(reqOf('customers'))).toBe(true)
		expect(narrowStatsGlobal(payload)).toBe(true)
		expect(await statsAccess(payload).read?.(reqOf('customers'))).toBe(false)
		expect(await statsAccess(payload).read?.(reqOf('users'))).toBe(true)
	})

	it('leaves the global alone when the plugin registered none of its tasks', () => {
		const { payload } = payloadWith({ read: () => true, update: () => true })
		Reflect.set(payload.config, 'jobs', { tasks: [task('send-email')] })
		expect(narrowStatsGlobal(payload)).toBe(false)
	})
})
