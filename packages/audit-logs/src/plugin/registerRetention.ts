import type { Config, TaskConfig } from 'payload'

import { buildArchiveTask } from '../jobs/archiveAuditLogs'
import { buildDeleteTask } from '../jobs/deleteAuditLogs'
import type { AnonymizeFunction, AuditPluginConfig, DataRetentionConfig } from '../types'

const DEFAULT_QUEUE = 'audit-retention'

/** Excluded from archives by default so a CSV sitting in an upload collection carries no PII. */
const DEFAULT_ARCHIVE_EXCLUDE_FIELDS = ['ipAddress', 'userAgent']

const TASK_SLUGS = ['audit-logs-archive', 'audit-logs-delete'] as const
type TaskSlug = (typeof TASK_SLUGS)[number]

const isTaskSlug = (value: string | null): value is TaskSlug =>
	TASK_SLUGS.includes(value as TaskSlug)

/**
 * Queues either retention task on demand. Only mounted under `debug`, because it lets
 * any logged-in user trigger a bulk delete.
 */
const registerDebugEndpoint = (config: Config, retention: DataRetentionConfig): void => {
	config.endpoints = [
		...(config.endpoints ?? []),
		{
			path: '/audit-retention/run',
			method: 'post',
			handler: async (req) => {
				if (!req.user) {
					return Response.json({ error: 'Unauthorized' }, { status: 401 })
				}
				const url = new URL(req.url ?? '', 'http://localhost')
				const task = url.searchParams.get('task')
				if (!isTaskSlug(task)) {
					return Response.json({ error: 'Invalid task' }, { status: 400 })
				}
				if (task === 'audit-logs-archive' && !retention.archive) {
					return Response.json({ error: 'Archive not configured' }, { status: 400 })
				}
				await req.payload.jobs.queue({
					task,
					input: undefined,
					queue: retention.queue ?? DEFAULT_QUEUE,
				})
				return Response.json({ queued: true, task })
			},
		},
	]
}

/**
 * Registers the archive and delete tasks. The plugin only supplies the task
 * definitions and their cron strings; running them is the host's job, through
 * `jobs.autoRun` or a bin script on the same queue.
 */
export const registerRetention = (config: Config, pluginOptions: AuditPluginConfig): void => {
	const retention = pluginOptions.retention
	if (pluginOptions.disabled || !retention) return

	if (pluginOptions.debug) {
		registerDebugEndpoint(config, retention)
	}

	const queue = retention.queue ?? DEFAULT_QUEUE
	const tasks: TaskConfig[] = []

	if (retention.archive) {
		tasks.push(
			buildArchiveTask({
				cron: retention.archive.cron,
				queue,
				uploadCollection: retention.archive.uploadCollection as string,
				where: retention.archive.where,
				anonymize: retention.archive.anonymize as Partial<Record<string, AnonymizeFunction>>,
				excludeFields: retention.archive.excludeFields ?? DEFAULT_ARCHIVE_EXCLUDE_FIELDS,
				generateFilename: retention.archive.generateFilename,
				populateUploadFields: retention.archive.populateUploadFields,
				hooks: retention.archive.hooks,
			})
		)
	}

	tasks.push(
		buildDeleteTask({
			cron: retention.deleteCron,
			queue,
			hasArchive: Boolean(retention.archive),
			where: retention.deleteWhere,
			hooks: retention.deleteHooks,
		})
	)

	config.jobs = {
		...config.jobs,
		tasks: [...(config.jobs?.tasks ?? []), ...tasks],
	}
}
