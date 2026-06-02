// biome-ignore-all lint/plugin/noProcessEnv: e2e orchestration env boundary
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = path.resolve(dirname, '..', '..') // packages/jobs

const mongoPort = process.env.MONGO_E2E_PORT ?? '37017'
const MONGO_URI = `mongodb://localhost:${mongoPort}/jobs_e2e?replicaSet=rs0&directConnection=true`

const childEnv: NodeJS.ProcessEnv = {
	...process.env,
	DATABASE_URI_MONGO: MONGO_URI,
	DEV_DB: 'mongo',
	JOBS_SKIP_SEED: '1',
	PAYLOAD_SECRET: 'e2e-secret',
	PAYLOAD_SKIP_AUTOGEN: '1',
	WORKER_DRAIN_TIMEOUT_MS: '2000',
	WORKER_RUN_INTERVAL_MS: '200',
}

const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(resolve, ms)
	})

const fail = (message: string): never => {
	console.error(`[worker-drain e2e] FAIL: ${message}`)
	return process.exit(1)
}

const main = async (): Promise<void> => {
	// Boot a controller Payload against the compose Mongo (same config as the worker).
	for (const [key, value] of Object.entries(childEnv)) {
		if (value !== undefined) {
			process.env[key] = value
		}
	}
	const { default: config } = await import('./../payload.config')
	const { getPayload } = await import('payload')
	const payload = await getPayload({ config })

	await payload.delete({ collection: 'payload-jobs', overrideAccess: true, where: {} })
	// A job that sleeps far longer than the worker's 2s drain budget, so the worker must
	// requeue it as a straggler rather than finish it. The dev app's generated
	// `payload-types.ts` augments `TypedJobs` with workflows but leaves `tasks` open
	// (`unknown`), so the typed `queue` overload rejects a free-string task slug; queue
	// through a structurally typed alias to assert the runtime-correct shape without `any`.
	const queueJob = payload.jobs.queue as unknown as (args: {
		input: { ms: number }
		task: string
	}) => Promise<unknown>
	await queueJob({ input: { ms: 60_000 }, task: 'sleep' })

	const worker = spawn('node', ['--import', 'tsx', 'dev/worker.ts'], {
		cwd: pkgRoot,
		env: childEnv,
		stdio: 'inherit',
	})
	let workerExit: null | number = null
	worker.on('exit', (code) => {
		workerExit = code ?? -1
	})

	// Wait until the worker has claimed the job.
	const claimDeadline = Date.now() + 30_000
	let claimed = false
	while (Date.now() < claimDeadline) {
		const { totalDocs } = await payload.count({
			collection: 'payload-jobs',
			where: { processing: { equals: true } },
		})
		if (totalDocs >= 1) {
			claimed = true
			break
		}
		await sleep(500)
	}
	if (!claimed) {
		worker.kill('SIGKILL')
		fail('worker never claimed the job')
	}

	// Real SIGTERM: require a clean drain and exit 0.
	worker.kill('SIGTERM')
	const exitDeadline = Date.now() + 15_000
	while (workerExit === null && Date.now() < exitDeadline) {
		await sleep(250)
	}
	if (workerExit === null) {
		worker.kill('SIGKILL')
		fail('worker did not exit after SIGTERM')
	}
	if (workerExit !== 0) {
		fail(`worker exited ${workerExit}, expected 0`)
	}

	// The in-flight job must have been requeued as a straggler.
	const { totalDocs: requeued } = await payload.count({
		collection: 'payload-jobs',
		where: {
			and: [{ processing: { equals: false } }, { recoveryAttempts: { greater_than: 0 } }],
		},
	})
	if (requeued < 1) {
		fail('the in-flight job was not requeued on drain')
	}

	await payload.destroy()
	console.log(
		'[worker-drain e2e] PASS: SIGTERM drained the worker (exit 0) and requeued the straggler'
	)
	process.exit(0)
}

main().catch((err) => {
	console.error('[worker-drain e2e] ERROR', err)
	process.exit(1)
})
