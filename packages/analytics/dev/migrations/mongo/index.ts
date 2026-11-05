import * as migration_20261007_050635_drop_legacy from './20261007_050635_drop_legacy'

export const migrations = [
	{
		up: migration_20261007_050635_drop_legacy.up,
		down: migration_20261007_050635_drop_legacy.down,
		name: '20261007_050635_drop_legacy',
	},
]
