import type { Payload } from 'payload'

const DEV_EMAIL = 'dev@10xmedia.de'
const DEV_PASSWORD = 'password'

const minutesAgo = (n: number): string => new Date(Date.now() - n * 60_000).toISOString()
const secondsFromNow = (n: number): string => new Date(Date.now() + n * 1000).toISOString()

const failedLog = (taskID: string, message: string) => ({
	executedAt: minutesAgo(2),
	completedAt: minutesAgo(2),
	taskSlug: 'inline',
	taskID,
	input: { automationId: 'demo' },
	state: 'failed',
	error: { message },
})

const succeededLog = (taskID: string) => ({
	executedAt: minutesAgo(3),
	completedAt: minutesAgo(3),
	taskSlug: 'inline',
	taskID,
	input: { automationId: 'demo' },
	output: { delivered: true },
	state: 'succeeded',
})

/** One sample job per derived status, so every default cell renders in the admin. */
const sampleJobs: Record<string, unknown>[] = [
	{
		workflowSlug: 'runAutomation',
		queue: 'default',
		totalTried: 0,
		input: { automationId: 'welcome-email' },
	},
	{
		workflowSlug: 'runAutomation',
		queue: 'default',
		totalTried: 0,
		waitUntil: secondsFromNow(3600),
		input: { automationId: 'weekly-digest' },
	},
	{
		workflowSlug: 'runAutomation',
		queue: 'emails',
		totalTried: 1,
		processing: true,
		input: { automationId: 'welcome-email' },
	},
	{
		workflowSlug: 'runAutomation',
		queue: 'default',
		totalTried: 2,
		waitUntil: secondsFromNow(30),
		input: { automationId: 'sync-crm' },
		log: [failedLog('sync', 'Upstream returned 503'), failedLog('sync', 'Upstream returned 503')],
	},
	{
		workflowSlug: 'runAutomation',
		queue: 'default',
		totalTried: 1,
		completedAt: minutesAgo(2),
		input: { automationId: 'welcome-email' },
		log: [succeededLog('send')],
	},
	{
		workflowSlug: 'runAutomation',
		queue: 'webhooks',
		totalTried: 3,
		hasError: true,
		error: { message: 'Connection refused (ECONNREFUSED)' },
		input: { automationId: 'notify-slack' },
		log: [
			failedLog('post', 'ECONNREFUSED'),
			failedLog('post', 'ECONNREFUSED'),
			failedLog('post', 'ECONNREFUSED'),
		],
	},
	{
		workflowSlug: 'runAutomation',
		queue: 'default',
		totalTried: 1,
		hasError: true,
		error: { cancelled: true },
		input: { automationId: 'cleanup-temp' },
	},
]

/**
 * Seed the dev app: an admin user to log in with, and one sample job per derived
 * status so the jobs collection renders across the full state space. Idempotent,
 * and resilient per job so one bad row cannot stop the app from booting.
 */
export const seedDev = async (payload: Payload): Promise<void> => {
	const userCount = await payload.count({ collection: 'users' })
	if (userCount.totalDocs === 0) {
		await payload.create({
			collection: 'users',
			data: { email: DEV_EMAIL, password: DEV_PASSWORD },
		})
		payload.logger.info(`Seeded dev admin: ${DEV_EMAIL} / ${DEV_PASSWORD}`)
	}

	const jobCount = await payload.count({ collection: 'payload-jobs' })
	if (jobCount.totalDocs === 0) {
		for (const data of sampleJobs) {
			try {
				await payload.create({ collection: 'payload-jobs', data: data as never })
			} catch (err) {
				payload.logger.error(`Failed to seed a sample job: ${(err as Error)?.message}`)
			}
		}
		payload.logger.info(`Seeded ${sampleJobs.length} sample jobs`)
	}
}
