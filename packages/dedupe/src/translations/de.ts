import { keys, type TranslationKey } from './keys'

export const de: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Dedupe',
	[keys.queueTitle]: 'Duplikate',
	[keys.collection]: 'Sammlung',
	[keys.statusOpen]: 'Offen',
	[keys.statusDismissed]: 'Keine Duplikate',
	[keys.noPairs]: 'Nichts zu prüfen.',
	[keys.noCollections]: 'Keine Sammlung ist für Dedupe konfiguriert.',
	[keys.dismiss]: 'Keine Duplikate',
	[keys.reopen]: 'Wieder öffnen',
	[keys.mergeInto]: 'In {{title}} zusammenführen',
	[keys.runScan]: 'Jetzt prüfen',
	[keys.scanQueued]: 'Prüfung eingereiht.',
	[keys.scanAlreadyQueued]: 'Ein Scan ist bereits eingereiht.',
	[keys.scanPending]: 'Scan eingereiht',
	[keys.scanRunning]: 'Scan läuft…',
	[keys.scanDone]: 'Prüfung beendet: {{pairs}} offene Paare aus {{compared}} Vergleichen.',
	[keys.needsChoice]: 'Entscheidung nötig',
	[keys.applied]: 'In das primäre Dokument zusammengeführt.',
	[keys.empty]: 'leer',
	[keys.selectTwo]: 'Zum Zusammenführen 2 bis {{max}} Dokumente auswählen.',
	[keys.mergeSelected]: 'Auswahl zusammenführen',
	[keys.transactionsRequired]:
		'Zusammenführen ist nicht verfügbar. Wenden Sie sich an Ihre Administration.',
	[keys.takenFrom]: 'Übernommen aus {{title}}',
	[keys.error]: 'Etwas ist schiefgelaufen.',
	[keys.missingParams]: 'Die Zusammenführung braucht eine Sammlung und zwei Dokument-IDs.',
	[keys.confirmHeading]: 'Zusammenführung anwenden?',
	[keys.confirmBody]:
		'{{absorbed}} wird in {{survivor}} zusammengeführt und verlässt die Sammlung.',
	[keys.primary]: 'Primär · behält seine ID',
	[keys.makePrimary]: 'Zum Primärdokument machen',
	[keys.created]: 'Erstellt',
	[keys.updated]: 'Geändert',
	[keys.onlyDifferences]: 'Nur Unterschiede',
	[keys.showDiff]: 'Unterschiede hervorheben',
	[keys.mergeCount]: '{{count}} Dokumente zusammenführen',
	[keys.releaseMarked]:
		'{{title}} kommt mit einem Platzhalter in {{fields}} in den Papierkorb, weil {{survivor}} diese Werte übernimmt und nur ein Dokument sie haben darf.',
	[keys.releaseEmptied]:
		'{{title}} kommt mit leerem {{fields}} in den Papierkorb, weil {{survivor}} diese Werte übernimmt und nur ein Dokument sie haben darf.',
	[keys.pointersCleared]:
		'Verweise auf Dokumente dieser Zusammenführung fallen aus {{fields}} weg: Danach würden sie auf ein entferntes Dokument oder auf {{survivor}} selbst zeigen.',
	[keys.survivorDraft]:
		'{{title}} hat unveröffentlichte Änderungen, die die Zusammenführung veröffentlichen würde. Veröffentliche oder verwirf sie zuerst.',
	[keys.mayNotApply]: 'Deine Berechtigungen erlauben diese Zusammenführung nicht.',
	[keys.releaseDeletes]:
		'{{title}} wird gelöscht statt in den Papierkorb verschoben, weil {{survivor}} {{fields}} übernimmt und nur ein Dokument diese Werte haben darf.',
	[keys.signals]: 'Warum sie passen',
	[keys.takeAll]: 'Alle Werte übernehmen',
	[keys.similarity]: 'Ähnlichkeit',
	[keys.whySame]: 'Gleich: {{fields}}',
	[keys.whySimilar]: 'Ähnlich: {{fields}}',
	[keys.whyDiffer]: 'Verschieden: {{fields}}',
	[keys.whyVeto]: 'Ausgeschlossen durch {{fields}}',
	[keys.markedBy]: 'Markiert von',
	[keys.aboutOpen]:
		'Ähnliche Dokumente, eine Zeile pro Gruppe, die auf eine Prüfung warten. Öffnen Sie eine, um sie zusammenzuführen oder als keine Duplikate zu markieren.',
	[keys.aboutDismissed]:
		'Als keine Duplikate markierte Dokumente, eine Zeile pro Gruppe. Spätere Scans lassen sie hier; öffnen Sie eine, um sie wieder zu öffnen.',
	[keys.markedNotDuplicates]: 'Als keine Duplikate markiert.',
	[keys.dismissedNote]: 'Von {{user}} am {{date}} als keine Duplikate markiert.',
	[keys.markedApart]:
		'{{a}} und {{b}} wurden von {{user}} am {{date}} als keine Duplikate markiert. Die Zusammenführung hebt das auf.',
	[keys.removeFromMerge]: 'Aus dieser Zusammenführung entfernen',
	[keys.removeHeading]: '{{title}} aus dieser Zusammenführung entfernen?',
	[keys.removeBody]:
		'Das Dokument selbst bleibt unverändert. Die hier daraus gewählten Werte werden verworfen.',
	[keys.andMore]: '{{title}} und {{count}} weitere',
	[keys.groupSize]: 'Gruppengröße',
	[keys.perMerge]: '{{count}}, bis zu {{max}} je Zusammenführung',
	[keys.leftOut]:
		'Ähnliche Dokumente, die nicht auf dieser Seite sind: {{count}}. Sie bleiben unter „Duplikate“.',
	[keys.draftDeleted]: '{{title}} hat unveröffentlichte Änderungen, die mit ihm gelöscht werden.',
}
