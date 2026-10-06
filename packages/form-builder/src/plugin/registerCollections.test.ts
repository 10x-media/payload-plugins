import type { CollectionConfig, Config, Field } from 'payload'
import { describe, expect, it } from 'vitest'
import { resolvePollTypes } from '../poll/pollTypeRegistry'
import { DEFAULT_COLLECTION_SLUGS, type FormBuilderCollectionSlugs } from './collectionSlugs'
import { registerCollections } from './registerCollections'

const register = (
	options: { pollVotes?: false | object; slugs?: FormBuilderCollectionSlugs } = {}
): CollectionConfig[] => {
	const config = { collections: [] } as unknown as Config
	registerCollections({
		config,
		registry: new Map(),
		ruleRegistry: new Map(),
		actionRegistry: new Map(),
		hasJobsPlugin: false,
		uploads: false,
		spam: false,
		showSubmissionRawFields: false,
		localizeContent: true,
		votedCookie: false,
		pollSourceRegistry: new Map(),
		pollTypeRegistry: resolvePollTypes(),
		pollVotes: options.pollVotes ?? {},
		slugs: options.slugs ?? { ...DEFAULT_COLLECTION_SLUGS },
	})
	return config.collections ?? []
}

const slugsOf = (collections: CollectionConfig[]) =>
	collections.map((collection) => collection.slug)

describe('registerCollections', () => {
	it('registers forms before form-submissions so the primary collection leads in nav order', () => {
		const slugs = slugsOf(register())
		const formsIndex = slugs.indexOf('forms')
		const submissionsIndex = slugs.indexOf('form-submissions')

		expect(formsIndex).toBeGreaterThanOrEqual(0)
		expect(submissionsIndex).toBeGreaterThanOrEqual(0)
		expect(formsIndex).toBeLessThan(submissionsIndex)
	})

	it('registers the hidden poll-votes collection after form-submissions when pollVotes is enabled', () => {
		const slugs = slugsOf(register())
		const submissionsIndex = slugs.indexOf('form-submissions')
		const votesIndex = slugs.indexOf('form-poll-votes')

		expect(votesIndex).toBeGreaterThanOrEqual(0)
		expect(submissionsIndex).toBeLessThan(votesIndex)
	})

	it('omits the poll-votes collection when pollVotes is false', () => {
		expect(slugsOf(register({ pollVotes: false }))).not.toContain('form-poll-votes')
	})

	it('registers every collection under its resolved slug and points submissions at the renamed forms', () => {
		const collections = register({
			slugs: { forms: 'surveys', formSubmissions: 'responses', pollVotes: 'survey-tallies' },
		})
		expect(slugsOf(collections)).toEqual(['surveys', 'responses', 'survey-tallies'])
		const submissions = collections.find((collection) => collection.slug === 'responses')
		const form = submissions?.fields.find(
			(field: Field) => 'name' in field && field.name === 'form'
		) as { relationTo?: unknown } | undefined
		expect(form?.relationTo).toBe('surveys')
	})
})
