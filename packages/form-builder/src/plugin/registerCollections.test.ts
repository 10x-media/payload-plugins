import type { Config } from 'payload'
import { describe, expect, it } from 'vitest'
import { resolvePollTypes } from '../poll/pollTypeRegistry'
import { registerCollections } from './registerCollections'

describe('registerCollections', () => {
	it('registers forms before form-submissions so the primary collection leads in nav order', () => {
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
			pollVotes: {},
		})

		const slugs = (config.collections ?? []).map((collection) => collection.slug)
		const formsIndex = slugs.indexOf('forms')
		const submissionsIndex = slugs.indexOf('form-submissions')

		expect(formsIndex).toBeGreaterThanOrEqual(0)
		expect(submissionsIndex).toBeGreaterThanOrEqual(0)
		expect(formsIndex).toBeLessThan(submissionsIndex)
	})

	it('registers the hidden poll-votes collection after form-submissions when pollVotes is enabled', () => {
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
			pollVotes: {},
		})

		const slugs = (config.collections ?? []).map((collection) => collection.slug)
		const submissionsIndex = slugs.indexOf('form-submissions')
		const votesIndex = slugs.indexOf('form-poll-votes')

		expect(votesIndex).toBeGreaterThanOrEqual(0)
		expect(submissionsIndex).toBeLessThan(votesIndex)
	})

	it('omits the poll-votes collection when pollVotes is false', () => {
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
			pollVotes: false,
		})

		const slugs = (config.collections ?? []).map((collection) => collection.slug)
		expect(slugs).not.toContain('form-poll-votes')
	})
})
