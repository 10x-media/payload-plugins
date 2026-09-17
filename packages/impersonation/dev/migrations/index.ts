import * as migration_20260917_112029_init from './20260917_112029_init'

export const migrations = [
	{
		up: migration_20260917_112029_init.up,
		down: migration_20260917_112029_init.down,
		name: '20260917_112029_init',
	},
]
