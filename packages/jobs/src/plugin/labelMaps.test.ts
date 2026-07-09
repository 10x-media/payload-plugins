import type { Config } from 'payload'
import { describe, expect, it } from 'vitest'
import { collectJobLabels } from './labelMaps'

describe('collectJobLabels', () => {
	it('maps slugs to labels, skipping unlabeled entries', () => {
		const config = {
			jobs: {
				tasks: [
					{ label: 'Send email', slug: 'sendEmail' },
					{ slug: 'syncCrm' },
					{ label: '', slug: 'blank' },
					{ label: 42, slug: 'numeric' },
				],
				workflows: [{ label: 'Atos sync', slug: 'atosSync' }],
			},
		} as unknown as Config
		expect(collectJobLabels(config)).toEqual({
			taskLabels: { sendEmail: 'Send email' },
			workflowLabels: { atosSync: 'Atos sync' },
		})
	})

	it('handles missing jobs config', () => {
		expect(collectJobLabels({} as Config)).toEqual({ taskLabels: {}, workflowLabels: {} })
	})
})
