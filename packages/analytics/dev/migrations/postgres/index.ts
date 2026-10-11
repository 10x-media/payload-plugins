import * as migration_20261009_100050_baseline from './20261009_100050_baseline'

export const migrations = [
	{
		up: migration_20261009_100050_baseline.up,
		down: migration_20261009_100050_baseline.down,
		name: '20261009_100050_baseline',
	},
]
