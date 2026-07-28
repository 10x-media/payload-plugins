import type { AnyValidationRuleDefinition } from '../types'
import { emailRule } from './email'
import { integerRule } from './integer'
import { matchesFieldRule } from './matchesField'
import { maxRule } from './max'
import { maxDateRule } from './maxDate'
import { maxLengthRule } from './maxLength'
import { minRule } from './min'
import { minDateRule } from './minDate'
import { minLengthRule } from './minLength'
import { notAlreadySubmittedRule } from './notAlreadySubmitted'
import { oneOfRule } from './oneOf'
import { patternRule } from './pattern'
import { urlRule } from './url'

// Rules are authored with precise param/value generics; the registry stores them erased (params
// re-narrow per matched rule at execution). One cast per rule, no `any`.
export const defaultValidationRules: AnyValidationRuleDefinition[] = [
	minLengthRule as AnyValidationRuleDefinition,
	maxLengthRule as AnyValidationRuleDefinition,
	minRule as AnyValidationRuleDefinition,
	maxRule as AnyValidationRuleDefinition,
	integerRule as AnyValidationRuleDefinition,
	minDateRule as AnyValidationRuleDefinition,
	maxDateRule as AnyValidationRuleDefinition,
	patternRule as AnyValidationRuleDefinition,
	emailRule as AnyValidationRuleDefinition,
	urlRule as AnyValidationRuleDefinition,
	oneOfRule as AnyValidationRuleDefinition,
	matchesFieldRule as AnyValidationRuleDefinition,
	notAlreadySubmittedRule as AnyValidationRuleDefinition,
]

/**
 * `defaultValidationRules` indexed by `type`, so a single built-in can be spread and tweaked
 * without hand-rolling a `.find()`, e.g.
 * `rules: { minLength: { ...defaultValidationRulesByType.minLength, message: myMessage } }`. The
 * `rules` plugin option replaces a built-in of the same `type`; `false` removes it, `true` keeps it.
 */
export const defaultValidationRulesByType: Record<string, AnyValidationRuleDefinition> =
	Object.fromEntries(defaultValidationRules.map((rule) => [rule.type, rule]))
