/** What the recovery layer does with a job whose previous run died. */
export type RecoveryDecision = 'deadLetter' | 'requeue'

/**
 * Run a recovered job again while it is below the recovery cap; dead-letter once it
 * reaches the cap, to stop a poison job from thrashing the queue. `recoveryAttempts`
 * is the count before this claim (running it again increments it). `maxRecoveries` of 0
 * dead-letters on the first orphan.
 */
export const decideRecovery = (
	recoveryAttempts: number,
	maxRecoveries: number
): RecoveryDecision => (recoveryAttempts < maxRecoveries ? 'requeue' : 'deadLetter')
