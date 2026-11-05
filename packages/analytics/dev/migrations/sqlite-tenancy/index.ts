import * as migration_20261009_100121_baseline from './20261009_100121_baseline'
import * as migration_20261015_083156_provider_default from './20261015_083156_provider_default'
import * as migration_20261016_100022_consent_modes from './20261016_100022_consent_modes'

export const migrations = [
	{
		up: migration_20261009_100121_baseline.up,
		down: migration_20261009_100121_baseline.down,
		name: '20261009_100121_baseline',
	},
	{
		up: migration_20261015_083156_provider_default.up,
		down: migration_20261015_083156_provider_default.down,
		name: '20261015_083156_provider_default',
	},
	{
		up: migration_20261016_100022_consent_modes.up,
		down: migration_20261016_100022_consent_modes.down,
		name: '20261016_100022_consent_modes',
	},
]
