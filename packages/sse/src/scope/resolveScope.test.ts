import { describe, expect, it } from 'vitest'

import { publicTopic, scopedTopic, toBrokerChannels } from './resolveScope'
import { SCOPE_WILDCARD } from './types'

describe('scopedTopic', () => {
	it('prefixes a public topic with the scope and a double-colon separator', () => {
		expect(scopedTopic('tenant-a', 'posts')).toBe('tenant-a::posts')
		expect(scopedTopic(SCOPE_WILDCARD, 'posts')).toBe('*::posts')
	})
})

describe('publicTopic', () => {
	it('strips a single scope prefix and leaves unprefixed topics alone', () => {
		expect(publicTopic('tenant-a::posts')).toBe('posts')
		expect(publicTopic('tenant-a::posts:abc')).toBe('posts:abc')
		expect(publicTopic('posts')).toBe('posts')
		expect(publicTopic('*::posts')).toBe('posts')
	})
})

describe('toBrokerChannels', () => {
	it('maps a concrete scope, an array, and the wildcard onto broker keys', () => {
		expect(toBrokerChannels('t1', 'posts')).toEqual(['t1::posts'])
		expect(toBrokerChannels(['t1', 't2'], 'posts')).toEqual(['t1::posts', 't2::posts'])
		expect(toBrokerChannels(SCOPE_WILDCARD, 'posts')).toEqual(['*::posts'])
	})
})
