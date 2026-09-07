import * as migration_20260824_182733_query_contract from './20260824_182733_query_contract'
import * as migration_20260907_031500_goal_counters from './20260907_031500_goal_counters'

export const migrations = [
	{
		up: migration_20260824_182733_query_contract.up,
		down: migration_20260824_182733_query_contract.down,
		name: '20260824_182733_query_contract',
	},
	{
		up: migration_20260907_031500_goal_counters.up,
		down: migration_20260907_031500_goal_counters.down,
		name: '20260907_031500_goal_counters',
	},
]
