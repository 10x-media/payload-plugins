import * as migration_20261009_100118_baseline from './20261009_100118_baseline'
import * as migration_20261016_100008_consent_modes from './20261016_100008_consent_modes'

export const migrations = [
	{
		up: migration_20261009_100118_baseline.up,
		down: migration_20261009_100118_baseline.down,
		name: '20261009_100118_baseline',
	},
	{
		up: migration_20261016_100008_consent_modes.up,
		down: migration_20261016_100008_consent_modes.down,
		name: '20261016_100008_consent_modes',
	},
]
