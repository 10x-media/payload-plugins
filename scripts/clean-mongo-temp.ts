/**
 * Sweeps abandoned `mongodb-memory-server` data directories out of the OS temp directory.
 *
 * The library only removes a dbPath when `stop()` is called, and nothing calls it when a run
 * dies abruptly: `next dev` SIGKILLs its server child 100 ms after Ctrl+C (and on Windows
 * `child.kill()` ignores the signal entirely), an interrupted vitest run never reaches
 * `afterAll`, and a failed replica set start is documented to skip cleanup on purpose. Each
 * orphan costs the size of a WiredTiger journal, so they add up to hundreds of gigabytes.
 *
 * `scripts/cleanup.sh` does not cover this: it only kills processes, and its PPID=1 orphan
 * check is POSIX-only.
 *
 * Run via `pnpm check:mongo-temp` (dry run) or `pnpm clean:mongo-temp`. Options:
 * `--dry-run`, `--min-age=<minutes>` (default 60, protects a live dev server).
 */

import { closeSync, openSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const TEMP_ROOT = tmpdir()
const PREFIX = 'mongo-mem-'
const DEFAULT_MIN_AGE_MINUTES = 60

const argv = process.argv.slice(2)
const dryRun = argv.includes('--dry-run')
const optionValue = (name: string): string | undefined =>
	argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1)

/** A live dev server's dbPath is touched constantly, so age alone separates it from an orphan. */
const minAgeMs = Number(optionValue('--min-age') ?? DEFAULT_MIN_AGE_MINUTES) * 60_000

interface DirStats {
	bytes: number
	newestMtimeMs: number
}

const scan = (dir: string): DirStats => {
	let bytes = 0
	let newestMtimeMs = 0
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name)
		try {
			if (entry.isDirectory()) {
				const nested = scan(path)
				bytes += nested.bytes
				newestMtimeMs = Math.max(newestMtimeMs, nested.newestMtimeMs)
				continue
			}
			const stats = statSync(path)
			bytes += stats.size
			newestMtimeMs = Math.max(newestMtimeMs, stats.mtimeMs)
		} catch {
			// Raced with a live mongod or another sweeper; the entry no longer counts.
		}
	}
	return { bytes, newestMtimeMs }
}

/**
 * Windows keeps `mongod.lock` open exclusively while mongod runs, so a failed `r+` open is a
 * reliable liveness probe there. POSIX uses flock, where the open succeeds either way, so the
 * age guard is what protects a running instance.
 */
const isLocked = (dir: string): boolean => {
	if (process.platform !== 'win32') return false
	try {
		closeSync(openSync(join(dir, 'mongod.lock'), 'r+'))
		return false
	} catch (error) {
		return (error as NodeJS.ErrnoException).code !== 'ENOENT'
	}
}

const formatBytes = (bytes: number): string => {
	if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
	if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`
	return `${(bytes / 1024).toFixed(0)} KB`
}

const candidates = readdirSync(TEMP_ROOT, { withFileTypes: true })
	.filter((entry) => entry.isDirectory() && entry.name.startsWith(PREFIX))
	.map((entry) => join(TEMP_ROOT, entry.name))

if (candidates.length === 0) {
	console.log(`No ${PREFIX}* directories in ${TEMP_ROOT}.`)
	process.exit(0)
}

let removedBytes = 0
let removedCount = 0
let skippedCount = 0

for (const dir of candidates) {
	let stats: DirStats
	try {
		stats = scan(dir)
	} catch {
		continue
	}

	const ageMs = Date.now() - stats.newestMtimeMs
	if (ageMs < minAgeMs) {
		console.log(
			`skip  ${dir}  ${formatBytes(stats.bytes)}  (active ${Math.round(ageMs / 60_000)}m ago)`
		)
		skippedCount++
		continue
	}
	if (isLocked(dir)) {
		console.log(`skip  ${dir}  ${formatBytes(stats.bytes)}  (mongod.lock held)`)
		skippedCount++
		continue
	}

	if (dryRun) {
		console.log(`would remove  ${dir}  ${formatBytes(stats.bytes)}`)
		removedBytes += stats.bytes
		removedCount++
		continue
	}

	try {
		rmSync(dir, { force: true, maxRetries: 3, recursive: true, retryDelay: 200 })
		console.log(`removed  ${dir}  ${formatBytes(stats.bytes)}`)
		removedBytes += stats.bytes
		removedCount++
	} catch (error) {
		console.log(`failed   ${dir}  ${(error as Error).message}`)
		skippedCount++
	}
}

console.log(
	`\n${dryRun ? 'Would free' : 'Freed'} ${formatBytes(removedBytes)} across ${removedCount} directory(ies). ${skippedCount} skipped.`
)
