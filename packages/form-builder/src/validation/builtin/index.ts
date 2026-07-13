import type { AnyValidationRuleDefinition } from '../types'
import { emailRule } from './email'
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
	minDateRule as AnyValidationRuleDefinition,
	maxDateRule as AnyValidationRuleDefinition,
	patternRule as AnyValidationRuleDefinition,
	emailRule as AnyValidationRuleDefinition,
	urlRule as AnyValidationRuleDefinition,
	oneOfRule as AnyValidationRuleDefinition,
	matchesFieldRule as AnyValidationRuleDefinition,
	notAlreadySubmittedRule as AnyValidationRuleDefinition,
]
