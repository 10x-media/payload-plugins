'use client'

import type { TranslationKey } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'

export type RuleDescriptionProps = {
	/**
	 * The rule's plain-language description as a translation key, resolved client-side. Payload has no
	 * native `Block` description slot and drops function `admin.description`, so the key travels as a
	 * clientProp and resolves here.
	 */
	descriptionKey: TranslationKey
}

/**
 * Leading `field-description` paragraph at the top of a validation rule's config block, explaining in
 * simple terms what makes the rule fail. Mounted as a `ui` field by `buildRuleBlocks`.
 */
export const RuleDescription = ({ descriptionKey }: RuleDescriptionProps) => {
	const { t } = useTranslation()
	return <p className="field-description">{t(descriptionKey)}</p>
}
