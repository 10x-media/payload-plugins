import { createRequire } from 'node:module'
import { join } from 'node:path'
import { SourceMisconfiguredError } from '../../../core/sourceErrors'
import { isRecord } from '../../../core/values'
import {
	isLibsqlClient,
	type LibsqlClient,
	type OwnConnection,
	type OwnConnectionRole,
	rowsOf,
} from './drivers'
import {
	type ClientResolution,
	hostLibsqlNatives,
	messageOf,
	resolveLibsqlClient,
	sameLibrary,
} from './sqliteThread'
import type { ClientConfig } from './sqliteWorker'

/** The file a client's main database is on: empty for one in memory. */
const fileOf = async (client: LibsqlClient): Promise<string> => {
	const main = rowsOf((await client.execute('PRAGMA database_list')).rows).find(
		(row) => row.name === 'main'
	)
	return typeof main?.file === 'string' ? main.file : ''
}

type Opened = { connection: LibsqlClient } | { reason: string }

/** Where the engine finds the host's `@libsql/client` and the libsql library behind it. */
export interface OwnConnectionDeps {
	resolveClient(): ClientResolution
	/** Requires a module by its absolute path. */
	load(path: string): unknown
	/** The libsql native libraries loaded in this thread, by real path. */
	natives(): string[]
}

const nodeDeps = (cwd: string): OwnConnectionDeps => ({
	resolveClient: () => resolveLibsqlClient(cwd),
	load: (path) => createRequire(join(cwd, 'package.json'))(path),
	natives: () => hostLibsqlNatives(cwd),
})

/**
 * A second connection to `client`'s file through the host's `@libsql/client` `createClient`,
 * refused when it would load another libsql library (two copies do not see each other's locks).
 */
const openOwn = async (
	client: LibsqlClient,
	config: ClientConfig,
	deps: OwnConnectionDeps
): Promise<Opened> => {
	if (typeof config.syncUrl === 'string' && config.syncUrl !== '') {
		return {
			reason: "the database is an embedded replica, which syncs through the app's client alone",
		}
	}
	const file = await fileOf(client)
	if (file === '') {
		return {
			reason: 'the database is in memory, where a second connection opens another, empty one',
		}
	}
	const resolved = deps.resolveClient()
	if ('failure' in resolved) {
		return { reason: resolved.failure }
	}
	const before = deps.natives()
	let createClient: unknown
	try {
		const loaded: unknown = deps.load(resolved.path)
		createClient = isRecord(loaded) ? loaded.createClient : undefined
	} catch (err) {
		return { reason: `${resolved.path} could not be loaded: ${messageOf(err)}` }
	}
	if (typeof createClient !== 'function') {
		return { reason: `${resolved.path} exports no createClient` }
	}
	if (sameLibrary(before, deps.natives()) !== 'same') {
		return {
			reason: `${resolved.path} could not be shown to run on the libsql library the app loaded, and two copies in one process do not see each other's locks`,
		}
	}
	let made: unknown
	try {
		made = createClient({ ...config })
	} catch (err) {
		return { reason: `createClient refused the adapter's client config: ${messageOf(err)}` }
	}
	if (!isLibsqlClient(made) || made.protocol !== 'file') {
		return { reason: `${resolved.path} made no local client` }
	}
	const same = await fileOf(made).then(
		(own) => own === file,
		() => false
	)
	if (!same) {
		made.close?.()
		return { reason: `the client ${resolved.path} made opened another file than ${file}` }
	}
	return { connection: made }
}

interface Held {
	opening: Promise<LibsqlClient>
	connection?: LibsqlClient
}

/** Each host client's own connections by role, shared by its drivers. */
const held = new WeakMap<object, Map<OwnConnectionRole, Held>>()

/** The host clients whose refusal was already reported, so it is said once per client. */
const reported = new WeakSet<object>()

const heldOf = (client: object): Map<OwnConnectionRole, Held> => {
	const known = held.get(client)
	if (known) {
		return known
	}
	const created = new Map<OwnConnectionRole, Held>()
	held.set(client, created)
	return created
}

/** Why the engine cannot run on a local SQLite file, which every statement it tries fails with. */
const refusal = (reason: string): SourceMisconfiguredError =>
	new SourceMisconfiguredError(
		`analytics: the native engine needs a SQLite connection of its own beside the app's, and cannot open one: ${reason}. Running on the app's libsql client instead could lose the app's writes, so the engine stays off until this is fixed.`
	)

export interface OwnConnectionOptions {
	warn?: (message: string) => void
	/** Where `@libsql/client` is resolved from; `process.cwd()` by default. */
	cwd?: string
	/** How the client is found and loaded: Node's own unless a test hands them in. */
	deps?: OwnConnectionDeps
}

/**
 * The engine's own connections beside `client`, one per role (libsql's `transaction()` leaks one
 * per day); where none can open, every use fails with a `SourceMisconfiguredError`, warned once.
 */
export const ownConnectionFor = (
	client: LibsqlClient,
	config: ClientConfig,
	options: OwnConnectionOptions = {}
): OwnConnection => ({
	get: (role) => {
		const roles = heldOf(client)
		const known = roles.get(role)
		if (known) {
			return known.opening
		}
		const deps = options.deps ?? nodeDeps(options.cwd ?? process.cwd())
		const entry: Held = {
			opening: openOwn(client, config, deps).then(
				(opened) => {
					if ('connection' in opened) {
						entry.connection = opened.connection
						return opened.connection
					}
					const error = refusal(opened.reason)
					if (!reported.has(client)) {
						reported.add(client)
						options.warn?.(error.message)
					}
					throw error
				},
				(err: unknown) => {
					// The database could not even be asked: the next use tries again.
					roles.delete(role)
					throw err
				}
			),
		}
		roles.set(role, entry)
		return entry.opening
	},
	discard: (connection) => {
		const roles = held.get(client)
		for (const [role, entry] of roles ?? []) {
			if (entry.connection === connection) {
				roles?.delete(role)
			}
		}
		connection.close?.()
	},
})

/** Closes the connections the engine opened beside `client`, as its Payload is destroyed. */
export const closeOwnConnection = async (client: object): Promise<void> => {
	const roles = held.get(client)
	held.delete(client)
	const connections = await Promise.allSettled(
		[...(roles?.values() ?? [])].map((each) => each.opening)
	)
	for (const outcome of connections) {
		if (outcome.status === 'fulfilled') {
			outcome.value.close?.()
		}
	}
}
