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
	[keys.scanAlreadyQueued]: "Une analyse est déjà en file d'attente.",
	[keys.scanPending]: 'Analyse en attente',
	[keys.scanRunning]: 'Analyse en cours…',
	[keys.scanDone]: 'Analyse terminée : {{pairs}} paires ouvertes sur {{compared}} comparaisons.',
	[keys.needsChoice]: 'Décision requise',
	[keys.applied]: 'Fusionné dans le document principal.',
	[keys.empty]: 'vide',
	[keys.selectTwo]: 'Sélectionnez de 2 à {{max}} documents à fusionner.',
	[keys.mergeSelected]: 'Fusionner la sélection',
	[keys.transactionsRequired]: "La fusion n'est pas disponible. Contactez votre administrateur.",
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
	[keys.groupSize]: 'Taille du groupe',
	[keys.perMerge]: '{{count}}, jusqu’à {{max}} par fusion',
	[keys.leftOut]:
		'Documents similaires absents de cet écran : {{count}}. Ils restent dans « Doublons ».',
	[keys.draftDeleted]: '{{title}} a des modifications non publiées, qui sont supprimées avec lui.',
}
