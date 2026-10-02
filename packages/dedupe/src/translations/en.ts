import { keys, type TranslationKey } from './keys'

/**
 * English values, keyed by the typed constants in `keys.ts` so the two stay in
 * lockstep. The `Record<TranslationKey, string>` annotation makes a missing or
 * unknown key a type error. `translations/index.ts` nests these for Payload.
 */
export const en: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Dedupe',
	[keys.queueTitle]: 'Duplicates',
	[keys.collection]: 'Collection',
	[keys.status]: 'Status',
	[keys.statusOpen]: 'Open',
	[keys.statusDismissed]: 'Not duplicates',
	[keys.statusMerged]: 'Merged',
	[keys.statusSuperseded]: 'Superseded',
	[keys.statusStale]: 'Stale',
	[keys.noPairs]: 'Nothing to review.',
	[keys.noCollections]: 'No collection is configured for dedupe.',
	[keys.dismiss]: 'Not duplicates',
	[keys.reopen]: 'Reopen',
	[keys.merge]: 'Merge',
	[keys.mergeInto]: 'Merge into {{title}}',
	[keys.runScan]: 'Scan now',
	[keys.scanQueued]: 'Scan queued.',
	[keys.scanDone]: 'Scan finished: {{pairs}} open pairs from {{compared}} comparisons.',
	[keys.needsChoice]: 'Needs a choice',
	[keys.applied]: 'Merged into the primary.',
	[keys.empty]: 'empty',
	[keys.backToQueue]: 'Back to duplicates',
	[keys.selectTwo]: 'Select 2 to {{max}} documents to merge.',
	[keys.mergeSelected]: 'Merge selected',
	[keys.noTransactions]:
		'This database opens no transactions. If the merge fails halfway, the steps already done stay done: placeholders on the merged-in documents, moved references, some languages of the primary. The merge record is marked failed and lists what moved.',
	[keys.transactionsRequired]:
		'Merging is off: this database opens no transactions, and the plugin is set to require one.',
	[keys.takenFrom]: 'Taken from {{title}}',
	[keys.error]: 'Something went wrong.',
	[keys.missingParams]: 'The merge screen needs a collection and two document ids.',
	[keys.confirmHeading]: 'Apply this merge?',
	[keys.confirmBody]:
		'{{absorbed}} will be merged into {{survivor}} and leave the collection. The merge is recorded with a copy of every document.',
	[keys.primary]: 'Primary · keeps its ID',
	[keys.makePrimary]: 'Make primary',
	[keys.created]: 'Created',
	[keys.updated]: 'Updated',
	[keys.linkedFrom]: 'Linked from',
	[keys.linkedFromTitle]: 'Documents linking to {{title}}',
	[keys.onlyDifferences]: 'Only differences',
	[keys.showDiff]: 'Highlight differences',
	[keys.referencesMove]: '{{count}} references move to {{title}}',
	[keys.mergeCount]: 'Merge {{count}} documents',
	[keys.releaseMarked]:
		'{{title}} goes to the trash with a placeholder in {{fields}}, because {{survivor}} takes those values and only one document may hold them. The merge record keeps the originals.',
	[keys.releaseEmptied]:
		'{{title}} goes to the trash with {{fields}} left empty, because {{survivor}} takes those values and only one document may hold them. The merge record keeps the originals.',
	[keys.pointersCleared]:
		'Pointers at documents of this merge are left out of {{fields}}: after the merge they would point at a document gone or at {{survivor}} itself.',
	[keys.survivorDraft]:
		'{{title}} has unpublished changes, which the merge would publish. Publish or discard them first.',
	[keys.mayNotApply]: 'Your access does not let you apply this merge.',
	[keys.releaseDeletes]:
		'{{title}} will be deleted instead of moved to the trash, because {{survivor}} takes its {{fields}} and only one document may hold those values. The merge record keeps a full copy.',
	[keys.openDrawer]: 'Inspect',
	[keys.signals]: 'Why they match',
	[keys.takeAll]: 'Keep all values',
	[keys.possibleDuplicates]: 'Possible duplicates',
	[keys.confirmCreateHeading]: 'This may already exist',
	[keys.confirmCreateBody]: 'Saved documents resemble the one you are creating:',
	[keys.createAnyway]: 'Create anyway',
	[keys.relatedDocuments]: 'Related documents',
	[keys.movesTo]: '{{count}} will move to {{title}}',
	[keys.moreDocs]: '+{{count}} more',
	[keys.referenceConflict]: 'One per {{fields}}: these two would collide',
	[keys.pendingDraft]: 'Has unpublished changes. Publish or discard them first.',
	[keys.tooManyReferences]:
		'{{count}} documents point at a merged-in document, more than a merge moves.',
	[keys.blocksMerge]: '{{count}} to resolve before merging',
	[keys.historyTitle]: 'Merge history',
	[keys.noMerges]: 'No merges yet.',
	[keys.mergedInto]: 'Merged into {{title}}',
	[keys.mergedIn]: 'Merged in',
	[keys.mergeApplying]: 'In progress',
	[keys.mergeApplied]: 'Applied',
	[keys.mergeFailed]: 'Failed',
	[keys.similarity]: 'Similarity',
	[keys.whySame]: 'Same {{fields}}',
	[keys.whySimilar]: 'Similar {{fields}}',
	[keys.whyDiffer]: 'Different {{fields}}',
	[keys.whyVeto]: 'Ruled out by {{fields}}',
	[keys.markedBy]: 'Marked by',
	[keys.aboutOpen]:
		'Documents that look alike, one row per group, waiting for a review. Open one to merge it or mark it not duplicates.',
	[keys.aboutDismissed]:
		'Documents marked as not duplicates, one row per group. Later scans keep them here; open one to reopen it.',
	[keys.aboutMerged]: 'Documents merged into one, one row per merge. Open one to see its merge.',
	[keys.aboutSuperseded]:
		'Look-alikes that no longer apply: a document was merged into another one or removed.',
	[keys.aboutStale]: 'Documents that stopped looking alike after an edit or a change of the rules.',
	[keys.markedNotDuplicates]: 'Marked as not duplicates.',
	[keys.dismissedNote]: 'Marked as not duplicates by {{user}} on {{date}}.',
	[keys.markedApart]:
		'{{a}} and {{b}} were marked as not duplicates by {{user}} on {{date}}. Merging them sets that aside.',
	[keys.removeFromMerge]: 'Remove from this merge',
	[keys.removeHeading]: 'Remove {{title}} from this merge?',
	[keys.removeBody]:
		'The document itself stays as it is. The values picked from it on this screen are dropped.',
	[keys.andMore]: '{{title}} and {{count}} more',
	[keys.pointsAt]: 'Points at',
	[keys.pointedAt]: 'Pointed at',
	[keys.mergingInto]: 'Merging into {{title}}',
	[keys.mergeFailedInto]: 'Merge into {{title}} failed',
	[keys.primaryRole]: 'Primary',
}
