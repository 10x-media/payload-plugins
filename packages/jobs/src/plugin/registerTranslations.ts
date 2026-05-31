import type { Config } from 'payload'
import { deepMergeSimple } from 'payload/shared'

import { translations } from '../translations'

type Translations = NonNullable<NonNullable<Config['i18n']>['translations']>

/**
 * Merge this plugin's translations into the host config. A host value wins on
 * conflict (`deepMergeSimple` lets the second argument override), so projects can
 * override any string.
 */
export const registerTranslations = (config: Config): void => {
	config.i18n ??= {}
	config.i18n.translations = deepMergeSimple<Translations>(
		translations,
		config.i18n.translations ?? {}
	)
}
