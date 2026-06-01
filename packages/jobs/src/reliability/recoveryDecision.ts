/** What the sweeper does with a reclaimed orphan. */
export type RecoveryDecision = 'deadLetter' | 'requeue'

/**
 * Requeue an orphaned job while it is below the recovery cap; dead-letter once it
 * reaches the cap, to stop a poison job from thrashing the queue. `recoveryAttempts`
 * is the count before this pass (a requeue increments it). `maxRecoveries` of 0
 * dead-letters on the first orphan.
 */
export const decideRecovery = (
	recoveryAttempts: number,
	maxRecoveries: number
): RecoveryDecision => (recoveryAttempts < maxRecoveries ? 'requeue' : 'deadLetter')
