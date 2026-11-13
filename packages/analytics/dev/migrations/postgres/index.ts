import * as migration_20261009_100050_baseline from './20261009_100050_baseline'
import * as migration_20261016_100025_consent_modes from './20261016_100025_consent_modes'

export const migrations = [
	{
		up: migration_20261009_100050_baseline.up,
		down: migration_20261009_100050_baseline.down,
		name: '20261009_100050_baseline',
	},
	{
		up: migration_20261016_100025_consent_modes.up,
		down: migration_20261016_100025_consent_modes.down,
		name: '20261016_100025_consent_modes',
	},
]
