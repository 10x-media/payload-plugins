/**
 * The email-format check shared by the `email` field type and the `email` validation rule, so the
 * two never drift. A pragmatic "one @, one dot, no spaces" test, not a full RFC 5322 grammar.
 */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
