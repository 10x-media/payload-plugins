import { keys, type TranslationKey } from './keys'

export const es: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Duplicados',
	[keys.queueTitle]: 'Duplicados',
	[keys.collection]: 'Colección',
	[keys.statusOpen]: 'Abiertos',
	[keys.statusDismissed]: 'No son duplicados',
	[keys.noPairs]: 'Nada que revisar.',
	[keys.noCollections]: 'Ninguna colección está configurada para buscar duplicados.',
	[keys.dismiss]: 'No son duplicados',
	[keys.reopen]: 'Reabrir',
	[keys.mergeInto]: 'Fusionar en {{title}}',
	[keys.runScan]: 'Analizar ahora',
	[keys.scanQueued]: 'Análisis en cola.',
	[keys.scanDone]: 'Análisis terminado: {{pairs}} pares abiertos de {{compared}} comparaciones.',
	[keys.needsChoice]: 'Requiere una decisión',
	[keys.applied]: 'Fusionado en el documento principal.',
	[keys.empty]: 'vacío',
	[keys.backToQueue]: 'Volver a los duplicados',
	[keys.selectTwo]: 'Selecciona de 2 a {{max}} documentos para fusionar.',
	[keys.mergeSelected]: 'Fusionar seleccionados',
	[keys.noTransactions]:
		'Esta base de datos no abre transacciones. Si la fusión falla a medias, los pasos ya hechos se quedan: marcadores en los documentos fusionados, referencias movidas, algunos idiomas del principal. El registro queda como fallido y lista lo que se movió.',
	[keys.transactionsRequired]:
		'Fusionar está desactivado: esta base de datos no abre transacciones y el plugin exige una.',
	[keys.takenFrom]: 'Tomado de {{title}}',
	[keys.error]: 'Algo salió mal.',
	[keys.missingParams]:
		'La pantalla de fusión necesita una colección y dos identificadores de documento.',
	[keys.confirmHeading]: '¿Aplicar esta fusión?',
	[keys.confirmBody]: '{{absorbed}} se fusionará en {{survivor}} y saldrá de la colección.',
	[keys.primary]: 'Principal · conserva su ID',
	[keys.makePrimary]: 'Hacer principal',
	[keys.created]: 'Creado',
	[keys.updated]: 'Actualizado',
	[keys.onlyDifferences]: 'Solo diferencias',
	[keys.showDiff]: 'Resaltar diferencias',
	[keys.mergeCount]: 'Fusionar {{count}} documentos',
	[keys.releaseMarked]:
		'{{title}} irá a la papelera con un marcador en {{fields}}, porque {{survivor}} toma esos valores y solo un documento puede tenerlos.',
	[keys.releaseEmptied]:
		'{{title}} irá a la papelera con {{fields}} vacío, porque {{survivor}} toma esos valores y solo un documento puede tenerlos.',
	[keys.pointersCleared]:
		'Los enlaces a documentos de esta fusión se quitan de {{fields}}: tras la fusión apuntarían a un documento eliminado o al propio {{survivor}}.',
	[keys.survivorDraft]:
		'{{title}} tiene cambios sin publicar que la fusión publicaría. Publícalos o descártalos primero.',
	[keys.mayNotApply]: 'Tus permisos no te permiten aplicar esta fusión.',
	[keys.releaseDeletes]:
		'{{title}} se eliminará en lugar de ir a la papelera, porque {{survivor}} toma su {{fields}} y solo un documento puede tener esos valores.',
	[keys.signals]: 'Por qué coinciden',
	[keys.takeAll]: 'Conservar todos los valores',
	[keys.similarity]: 'Similitud',
	[keys.whySame]: 'Mismo: {{fields}}',
	[keys.whySimilar]: 'Similar: {{fields}}',
	[keys.whyDiffer]: 'Distinto: {{fields}}',
	[keys.whyVeto]: 'Descartado por {{fields}}',
	[keys.markedBy]: 'Marcado por',
	[keys.aboutOpen]:
		'Documentos parecidos, una fila por grupo, a la espera de revisión. Abra una para fusionarla o marcarla como no duplicados.',
	[keys.aboutDismissed]:
		'Documentos marcados como no duplicados, una fila por grupo. Los escaneos posteriores los mantienen aquí; abra una para reabrirla.',
	[keys.markedNotDuplicates]: 'Marcados como no duplicados.',
	[keys.dismissedNote]: 'Marcados como no duplicados por {{user}} el {{date}}.',
	[keys.markedApart]:
		'{{a}} y {{b}} fueron marcados como no duplicados por {{user}} el {{date}}. Fusionarlos deja eso sin efecto.',
	[keys.removeFromMerge]: 'Quitar de esta fusión',
	[keys.removeHeading]: '¿Quitar {{title}} de esta fusión?',
	[keys.removeBody]:
		'El documento en sí no cambia. Se descartan los valores elegidos de él en esta pantalla.',
	[keys.andMore]: '{{title}} y {{count}} más',
}
