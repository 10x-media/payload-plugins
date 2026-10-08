import { keys, type TranslationKey } from './keys'

export const fr: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Doublons',
	[keys.queueTitle]: 'Doublons',
	[keys.collection]: 'Collection',
	[keys.statusOpen]: 'Ouverts',
	[keys.statusDismissed]: 'Pas des doublons',
	[keys.noPairs]: 'Rien à vérifier.',
	[keys.noCollections]: "Aucune collection n'est configurée pour la recherche de doublons.",
	[keys.dismiss]: 'Pas des doublons',
	[keys.reopen]: 'Rouvrir',
	[keys.mergeInto]: 'Fusionner dans {{title}}',
	[keys.runScan]: 'Analyser maintenant',
	[keys.scanQueued]: "Analyse mise en file d'attente.",
	[keys.scanDone]: 'Analyse terminée : {{pairs}} paires ouvertes sur {{compared}} comparaisons.',
	[keys.needsChoice]: 'Décision requise',
	[keys.applied]: 'Fusionné dans le document principal.',
	[keys.empty]: 'vide',
	[keys.selectTwo]: 'Sélectionnez de 2 à {{max}} documents à fusionner.',
	[keys.mergeSelected]: 'Fusionner la sélection',
	[keys.noTransactions]:
		"Cette base de données n'ouvre pas de transactions. Si la fusion échoue avant l'écriture du document principal, les documents fusionnés retrouvent leurs valeurs. Si elle échoue après, le document principal garde ce qui a été écrit et les documents fusionnés restent en place, avec des valeurs provisoires à la place des valeurs uniques cédées. Les références que l'application a déplacées vers le document principal avant l'échec y restent. Une fusion qui devrait d'abord supprimer un document est refusée.",
	[keys.transactionsRequired]:
		"La fusion est désactivée : cette base de données n'ouvre pas de transactions et le plugin en exige une.",
	[keys.takenFrom]: 'Repris de {{title}}',
	[keys.error]: "Quelque chose s'est mal passé.",
	[keys.missingParams]:
		"L'écran de fusion a besoin d'une collection et de deux identifiants de document.",
	[keys.confirmHeading]: 'Appliquer cette fusion ?',
	[keys.confirmBody]: '{{absorbed}} sera fusionné dans {{survivor}} et quittera la collection.',
	[keys.primary]: 'Principal · garde son ID',
	[keys.makePrimary]: 'Rendre principal',
	[keys.created]: 'Créé',
	[keys.updated]: 'Modifié',
	[keys.onlyDifferences]: 'Différences uniquement',
	[keys.showDiff]: 'Surligner les différences',
	[keys.mergeCount]: 'Fusionner {{count}} documents',
	[keys.releaseMarked]:
		'{{title}} ira à la corbeille avec un marqueur dans {{fields}}, car {{survivor}} reprend ces valeurs et un seul document peut les porter.',
	[keys.releaseEmptied]:
		'{{title}} ira à la corbeille avec {{fields}} vide, car {{survivor}} reprend ces valeurs et un seul document peut les porter.',
	[keys.pointersCleared]:
		'Les liens vers des documents de cette fusion sont retirés de {{fields}} : après la fusion, ils pointeraient vers un document supprimé ou vers {{survivor}} lui-même.',
	[keys.survivorDraft]:
		'{{title}} a des modifications non publiées, que la fusion publierait. Publiez-les ou annulez-les d’abord.',
	[keys.mayNotApply]: 'Vos droits ne vous permettent pas d’appliquer cette fusion.',
	[keys.releaseDeletes]:
		"{{title}} sera supprimé au lieu d'aller à la corbeille, car {{survivor}} reprend son {{fields}} et un seul document peut porter ces valeurs.",
	[keys.signals]: 'Pourquoi ils correspondent',
	[keys.takeAll]: 'Garder toutes les valeurs',
	[keys.similarity]: 'Similarité',
	[keys.whySame]: 'Identique : {{fields}}',
	[keys.whySimilar]: 'Similaire : {{fields}}',
	[keys.whyDiffer]: 'Différent : {{fields}}',
	[keys.whyVeto]: 'Exclu par {{fields}}',
	[keys.markedBy]: 'Marqué par',
	[keys.aboutOpen]:
		'Documents qui se ressemblent, une ligne par groupe, en attente de revue. Ouvrez-en une pour la fusionner ou la marquer comme non doublons.',
	[keys.aboutDismissed]:
		'Documents marqués comme non doublons, une ligne par groupe. Les analyses suivantes les gardent ici ; ouvrez-en une pour la rouvrir.',
	[keys.markedNotDuplicates]: 'Marqués comme non doublons.',
	[keys.dismissedNote]: 'Marqués comme non doublons par {{user}} le {{date}}.',
	[keys.markedApart]:
		'{{a}} et {{b}} ont été marqués comme non doublons par {{user}} le {{date}}. Les fusionner annule ce choix.',
	[keys.removeFromMerge]: 'Retirer de cette fusion',
	[keys.removeHeading]: 'Retirer {{title}} de cette fusion ?',
	[keys.removeBody]:
		'Le document lui-même reste inchangé. Les valeurs choisies depuis lui sur cet écran sont abandonnées.',
	[keys.andMore]: '{{title}} et {{count}} autres',
	[keys.draftDeleted]: '{{title}} a des modifications non publiées, qui sont supprimées avec lui.',
}
