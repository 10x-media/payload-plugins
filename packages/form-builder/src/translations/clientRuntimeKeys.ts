import type { TranslationKey } from './keys'
import { keys } from './keys'

/**
 * The typed keys the visitor-facing runtime (`<Form>`, `<Poll>`, `<FormResults>`, and the field
 * renderers) resolves through `RendererTranslate`. A host bridging its own i18n can assert its mirror
 * covers these in a unit test, the non-drifting form of a hand-written `dist/` diff. Kept in exact
 * lockstep with `src/react/**` by `clientRuntimeKeys.test.ts`.
 *
 * For a complete, drift-proof fallback prefer `makeTranslate(locale)` (or
 * `makeTranslate(bundles[locale] ?? en)`): a shipped bundle covers every key, including the
 * client-side validation messages resolved outside these components, so no key can leak English.
 */
export const clientRuntimeKeys: readonly TranslationKey[] = [
	keys.formSubmit,
	keys.formNext,
	keys.formBack,
	keys.formClose,
	keys.formSuccess,
	keys.formSubmitFailed,
	keys.formStepStatus,
	keys.formStepInvalid,
	keys.flowStepFallbackTitle,
	keys.repeaterAddRow,
	keys.repeaterRemoveRow,
	keys.repeaterRow,
	keys.fileUploading,
	keys.fileUploaded,
	keys.fileRemove,
	keys.fileTooLarge,
	keys.fileUploadFailed,
	keys.fileUploadMisconfigured,
	keys.fileHintAccepted,
	keys.fileHintMaxSize,
	keys.pollChangeVote,
	keys.pollClosed,
	keys.pollFinalResult,
	keys.pollResultsAfterClose,
	keys.pollResultsError,
	keys.resultsNoResponses,
	keys.resultsResponses,
	keys.resultsTruncated,
	keys.resultsWinner,
	keys.resultsYourVote,
]
