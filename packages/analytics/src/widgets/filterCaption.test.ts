import { describe, expect, it } from 'vitest'
import { keys } from '../translations/keys'
import type { Translate } from '../translations/server'
import { captionWithFilter, filterCaption } from './filterCaption'

/** One pass, like Payload's own `replaceVars`, so a filled value is never refilled. */
const fill = (template: string, vars: Record<string, string | number> | undefined): string =>
	template.replace(/\{\{(.*?)\}\}/g, (match, name: string) => {
		const value = vars?.[name.trim()]
		return value === undefined ? match : String(value)
	})

const CAPTION = 'where {{dimension}} {{operator}} {{value}}'

/** Only the sentence is translated, so the parts show which keys they came from. */
const bare: Translate = (key, vars) => fill(key === keys.widgetFilterCaption ? CAPTION : key, vars)

const EN: Record<string, string> = {
	[keys.widgetFilterCaption]: CAPTION,
	[keys.widgetCaptionWithFilter]: '{{window}} {{filter}}',
	[keys.filterOperatorEq]: 'is',
	[keys.filterOperatorContains]: 'contains',
	[keys.filterOperatorMatches]: 'matches pattern',
	[keys.viewDimensionCountry]: 'Country',
	[keys.viewDimensionPage]: 'Page',
}

const english: Translate = (key, vars) => fill(EN[key] ?? key, vars)

describe('filterCaption', () => {
	it('reads as a sentence for an eq filter', () => {
		expect(filterCaption({ dimension: 'country', operator: 'eq', value: 'DE' }, english)).toBe(
			'where Country is DE'
		)
	})

	it('reads as a sentence for a contains filter', () => {
		expect(
			filterCaption({ dimension: 'page', operator: 'contains', value: '/blog' }, english)
		).toBe('where Page contains /blog')
	})

	it('reads as a sentence for a matches filter', () => {
		expect(
			filterCaption({ dimension: 'page', operator: 'matches', value: '^/docs' }, english)
		).toBe('where Page matches pattern ^/docs')
	})

	it('names the dimension and the operator through their own label keys', () => {
		expect(filterCaption({ dimension: 'country', operator: 'eq', value: 'DE' }, bare)).toBe(
			`where ${keys.viewDimensionCountry} ${keys.filterOperatorEq} DE`
		)
	})

	it('passes the value through verbatim, so a placeholder in it is not refilled', () => {
		expect(
			filterCaption({ dimension: 'page', operator: 'matches', value: '^/a{{value}}' }, english)
		).toBe('where Page matches pattern ^/a{{value}}')
	})
})

describe('captionWithFilter', () => {
	it('joins the window and the sentence through the locale template', () => {
		expect(
			captionWithFilter(
				'Last 30 days',
				{ dimension: 'country', operator: 'eq', value: 'DE' },
				english
			)
		).toBe('Last 30 days where Country is DE')
	})

	it('lets a locale join them without a space', () => {
		const zh: Translate = (key, vars) =>
			fill(key === keys.widgetCaptionWithFilter ? '{{window}}{{filter}}' : (EN[key] ?? key), vars)
		expect(
			captionWithFilter('最近 30 天', { dimension: 'country', operator: 'eq', value: 'DE' }, zh)
		).toBe('最近 30 天where Country is DE')
	})

	it('leaves the window alone with no filter', () => {
		expect(captionWithFilter('Last 30 days', undefined, english)).toBe('Last 30 days')
	})

	it('fills the join in one pass, so a placeholder in the value survives', () => {
		expect(
			captionWithFilter(
				'Last 30 days',
				{ dimension: 'page', operator: 'matches', value: '^/a{{window}}' },
				english
			)
		).toBe('Last 30 days where Page matches pattern ^/a{{window}}')
	})
})
