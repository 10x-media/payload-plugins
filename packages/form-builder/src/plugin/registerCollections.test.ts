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
		})

		const slugs = (config.collections ?? []).map((collection) => collection.slug)
		const formsIndex = slugs.indexOf('forms')
		const submissionsIndex = slugs.indexOf('form-submissions')

		expect(formsIndex).toBeGreaterThanOrEqual(0)
		expect(submissionsIndex).toBeGreaterThanOrEqual(0)
		expect(formsIndex).toBeLessThan(submissionsIndex)
	})
})
