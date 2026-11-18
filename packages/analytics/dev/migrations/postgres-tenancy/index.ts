import * as migration_20261009_100110_baseline from './20261009_100110_baseline'
import * as migration_20261015_083216_provider_default from './20261015_083216_provider_default'
import * as migration_20261016_100028_consent_modes from './20261016_100028_consent_modes'
import * as migration_20261110_132048_payload_4 from './20261110_132048_payload_4'
import * as migration_20261118_205750_payload_4_beta_10 from './20261118_205750_payload_4_beta_10'

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
	{
		up: migration_20261016_100028_consent_modes.up,
		down: migration_20261016_100028_consent_modes.down,
		name: '20261016_100028_consent_modes',
	},
	{
		up: migration_20261110_132048_payload_4.up,
		down: migration_20261110_132048_payload_4.down,
		name: '20261110_132048_payload_4',
	},
	{
		up: migration_20261118_205750_payload_4_beta_10.up,
		down: migration_20261118_205750_payload_4_beta_10.down,
		name: '20261118_205750_payload_4_beta_10',
	},
]
