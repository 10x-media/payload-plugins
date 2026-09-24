import * as migration_20260917_112029_init from './20260917_112029_init'
import * as migration_20260921_140000_posts from './20260921_140000_posts'

export const migrations = [
	{
		up: migration_20260917_112029_init.up,
		down: migration_20260917_112029_init.down,
		name: '20260917_112029_init',
	},
	{
		up: migration_20260921_140000_posts.up,
		down: migration_20260921_140000_posts.down,
		name: '20260921_140000_posts',
	},
]
