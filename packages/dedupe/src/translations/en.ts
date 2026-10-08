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
	[keys.statusOpen]: 'Open',
	[keys.statusDismissed]: 'Not duplicates',
	[keys.noPairs]: 'Nothing to review.',
	[keys.noCollections]: 'No collection is configured for dedupe.',
	[keys.dismiss]: 'Not duplicates',
	[keys.reopen]: 'Reopen',
	[keys.mergeInto]: 'Merge into {{title}}',
	[keys.runScan]: 'Scan now',
	[keys.scanQueued]: 'Scan queued.',
	[keys.scanDone]: 'Scan finished: {{pairs}} open pairs from {{compared}} comparisons.',
	[keys.needsChoice]: 'Needs a choice',
	[keys.applied]: 'Merged into the primary.',
	[keys.empty]: 'empty',
	[keys.selectTwo]: 'Select 2 to {{max}} documents to merge.',
	[keys.mergeSelected]: 'Merge selected',
	[keys.noTransactions]:
		'This database opens no transactions. If the merge fails before the primary is written, the merged-in documents get their values back. If it fails later, the primary keeps what was written and the merged-in documents stay in place, with placeholders for the unique values they gave up. References the app moved to the primary before the failure stay there. A merge that would have to delete a document first is refused.',
	[keys.transactionsRequired]:
		'Merging is off: this database opens no transactions, and the plugin is set to require one.',
	[keys.takenFrom]: 'Taken from {{title}}',
	[keys.error]: 'Something went wrong.',
	[keys.missingParams]: 'The merge screen needs a collection and two document ids.',
	[keys.confirmHeading]: 'Apply this merge?',
	[keys.confirmBody]: '{{absorbed}} will be merged into {{survivor}} and leave the collection.',
	[keys.primary]: 'Primary · keeps its ID',
	[keys.makePrimary]: 'Make primary',
	[keys.created]: 'Created',
	[keys.updated]: 'Updated',
	[keys.onlyDifferences]: 'Only differences',
	[keys.showDiff]: 'Highlight differences',
	[keys.mergeCount]: 'Merge {{count}} documents',
	[keys.releaseMarked]:
		'{{title}} goes to the trash with a placeholder in {{fields}}, because {{survivor}} takes those values and only one document may hold them.',
	[keys.releaseEmptied]:
		'{{title}} goes to the trash with {{fields}} left empty, because {{survivor}} takes those values and only one document may hold them.',
	[keys.pointersCleared]:
		'Pointers at documents of this merge are left out of {{fields}}: after the merge they would point at a document gone or at {{survivor}} itself.',
	[keys.survivorDraft]:
		'{{title}} has unpublished changes, which the merge would publish. Publish or discard them first.',
	[keys.mayNotApply]: 'Your access does not let you apply this merge.',
	[keys.releaseDeletes]:
		'{{title}} will be deleted instead of moved to the trash, because {{survivor}} takes its {{fields}} and only one document may hold those values.',
	[keys.signals]: 'Why they match',
	[keys.takeAll]: 'Keep all values',
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
	[keys.markedNotDuplicates]: 'Marked as not duplicates.',
	[keys.dismissedNote]: 'Marked as not duplicates by {{user}} on {{date}}.',
	[keys.markedApart]:
		'{{a}} and {{b}} were marked as not duplicates by {{user}} on {{date}}. Merging them sets that aside.',
	[keys.removeFromMerge]: 'Remove from this merge',
	[keys.removeHeading]: 'Remove {{title}} from this merge?',
	[keys.removeBody]:
		'The document itself stays as it is. The values picked from it on this screen are dropped.',
	[keys.andMore]: '{{title}} and {{count}} more',
	[keys.groupSize]: 'Group size',
	[keys.perMerge]: '{{count}}, up to {{max}} per merge',
	[keys.leftOut]: 'Similar documents not on this screen: {{count}}. They stay in Duplicates.',
	[keys.draftDeleted]: '{{title}} has unpublished changes, which are deleted with it.',
}
