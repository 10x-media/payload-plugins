import * as migration_20260824_182733_query_contract from './20260824_182733_query_contract'

export const migrations = [
	{
		up: migration_20260824_182733_query_contract.up,
		down: migration_20260824_182733_query_contract.down,
		name: '20260824_182733_query_contract',
	},
]
