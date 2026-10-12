import * as migration_20261009_100110_baseline from './20261009_100110_baseline'

export const migrations = [
	{
		up: migration_20261009_100110_baseline.up,
		down: migration_20261009_100110_baseline.down,
		name: '20261009_100110_baseline',
	},
]
