import * as migration_20261009_100110_baseline from './20261009_100110_baseline'
import * as migration_20261015_083216_provider_default from './20261015_083216_provider_default'

export const migrations = [
	{
		up: migration_20261009_100110_baseline.up,
		down: migration_20261009_100110_baseline.down,
		name: '20261009_100110_baseline',
	},
	{
		up: migration_20261015_083216_provider_default.up,
		down: migration_20261015_083216_provider_default.down,
		name: '20261015_083216_provider_default',
	},
]
