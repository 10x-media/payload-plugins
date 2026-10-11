import { describe, expect, it } from 'vitest'

import { CommandOption, rankCommands } from './SlashMenu'

const option = (key: string, label: string, keywords?: string[]) =>
	new CommandOption({
		group: 'G',
		groupKey: 'g',
		item: { key, keywords, onSelect: () => undefined },
		label,
	})

const commands = [
	option('link', 'Link', ['url', 'href']),
	option('bulletList', 'Bulleted list', ['ul', 'unordered', 'bullet']),
	option('numberedList', 'Numbered list', ['ol', 'ordered', 'number']),
	option('color-red', 'Red text', ['color', 'red']),
	option('mention', 'Mention someone', ['user', 'person']),
]

const keys = (query: string) => rankCommands(commands, query).map((entry) => entry.item.key)

describe('slash command ranking', () => {
	it('keeps group order without a query', () => {
		expect(keys('')).toEqual(commands.map((entry) => entry.item.key))
	})

	it('puts a label prefix before keyword matches', () => {
		expect(keys('red')).toEqual(['color-red'])
		expect(keys('li')).toEqual(['link', 'bulletList', 'numberedList'])
	})

	it('matches word starts, then keywords by prefix', () => {
		expect(keys('some')).toEqual(['mention'])
		expect(keys('url')).toEqual(['link'])
		expect(keys('ord')).toEqual(['numberedList'])
	})
})
