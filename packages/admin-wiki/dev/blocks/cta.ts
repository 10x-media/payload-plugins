import type { Block } from 'payload'

/**
 * A registry block whose slug is deliberately also declared inline, by
 * `settings.sections`, with a different field set. Payload permits that (its
 * duplicate check runs per blocks field, not across the config) and resolves it
 * registry-first in parts of its own admin, so the wiki does the same: both
 * variants are walked under `block:cta`, `label` merges into one target, `style`
 * and the inline variant's `url` each surface only where their variant renders,
 * and the plugin logs one divergence warning on boot naming both origins.
 *
 * The dev app keeps the collision on purpose. It is the case that is easy to get
 * wrong and impossible to notice without a fixture.
 */
export const ctaBlock: Block = {
	slug: 'cta',
	labels: { singular: 'Call to action', plural: 'Calls to action' },
	fields: [
		{ name: 'label', type: 'text', localized: true },
		{
			name: 'style',
			type: 'select',
			defaultValue: 'primary',
			options: ['primary', 'secondary'],
		},
	],
}
