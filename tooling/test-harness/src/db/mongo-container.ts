import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'

export interface MongoContainerDb {
	adapter: ReturnType<typeof mongooseAdapter>
	stop: () => Promise<void>
	connectionString: string
}

/**
 * Boots a real `mongo:8` container configured as a single-node replica set.
 * Required for Payload transaction tests that need multi-connection semantics
 * the in-process replSet cannot faithfully simulate.
 *
 * Slower than the memory variant (~5s startup). Use only when transaction
 * parity matters; default to the memory adapter otherwise.
 */
export const startMongoContainer = async (): Promise<MongoContainerDb> => {
	const dbName = `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
	const container: StartedTestContainer = await new GenericContainer('mongo:8')
		.withCommand(['mongod', '--replSet', 'rs0', '--bind_ip_all', '--port', '27017'])
		.withExposedPorts(27017)
		.withWaitStrategy(Wait.forLogMessage(/Waiting for connections/))
		.start()

	const host = container.getHost()
	const port = container.getMappedPort(27017)

	await container.exec([
		'mongosh',
		'--quiet',
		'--eval',
		'rs.initiate({_id: "rs0", members: [{_id: 0, host: "localhost:27017"}]})',
	])

	for (let attempt = 0; attempt < 30; attempt += 1) {
		const result = await container.exec([
			'mongosh',
			'--quiet',
			'--eval',
			'db.hello().isWritablePrimary',
		])
		if (result.output.trim().endsWith('true')) break
		await new Promise((resolve) => setTimeout(resolve, 250))
	}

	const uri = `mongodb://${host}:${port}/${dbName}?replicaSet=rs0&directConnection=true`
	const adapter = mongooseAdapter({ ensureIndexes: true, url: uri })

	return {
		adapter,
		connectionString: uri,
		stop: async () => {
			await container.stop({ timeout: 5_000 })
		},
	}
}
