import * as migration_20261009_100050_baseline from './20261009_100050_baseline'
import * as migration_20261016_100025_consent_modes from './20261016_100025_consent_modes'
import * as migration_20261110_131949_payload_4 from './20261110_131949_payload_4'
import * as migration_20261118_205712_payload_4_beta_10 from './20261118_205712_payload_4_beta_10'

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
	{
		up: migration_20261110_131949_payload_4.up,
		down: migration_20261110_131949_payload_4.down,
		name: '20261110_131949_payload_4',
	},
	{
		up: migration_20261118_205712_payload_4_beta_10.up,
		down: migration_20261118_205712_payload_4_beta_10.down,
		name: '20261118_205712_payload_4_beta_10',
	},
]
