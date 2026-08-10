import { keys, type TranslationKey } from './keys'

/**
 * English values, keyed by the typed constants in `keys.ts` so the two stay in
 * lockstep. The `Record<TranslationKey, string>` annotation makes a missing or
 * unknown key a type error. `translations/index.ts` nests these for Payload.
 */
export const de: Record<TranslationKey, string> = {
    [keys.pluginName]: 'Audit-Protokolle',
      // View header
      [keys.title]: 'Audit-Protokoll',
      [keys.entries]: '{{count}} Einträge',

      // Breadcrumb / step nav
      [keys.breadcrumb]: 'Audit-Protokoll',

      // Access messages (server-rendered)
      [keys.mustBeLoggedIn]: 'Sie müssen angemeldet sein, um das Audit-Protokoll anzuzeigen.',
      [keys.noPermission]: 'Sie haben keine Berechtigung, das Audit-Protokoll anzuzeigen.',
      [keys.selectTenant]: 'Wählen Sie einen Mandanten aus, um das Audit-Protokoll anzuzeigen.',

      // Empty state
      [keys.noEntries]: 'Keine Audit-Protokoll-Einträge gefunden.',

      // Pagination
      [keys.paginationInfo]: '{{from}}–{{to}} von {{total}}',

      // Debug bar
      [keys.debug]: 'Debug',
      [keys.queuing]: 'Wird eingereiht…',
      [keys.runArchive]: 'Archivierung starten',
      [keys.runDelete]: 'Löschung starten',

      // Filter bar
      [keys.filterCollection]: 'Kollektion',
      [keys.filterGlobal]: 'Global',
      [keys.filterOperation]: 'Operation',
      [keys.filterTenant]: 'Mandant',
      [keys.filterUser]: 'Benutzer',
      [keys.filterDocument]: 'Dokument',
      [keys.filterEventType]: 'Ereignistyp',
      [keys.filterChangedPath]: 'Geänderter Pfad',
      [keys.filterGroup]: 'Gruppe',
      [keys.groupFilterBtn]: 'Nach Gruppe filtern',
      [keys.filterDate]: 'Datum',
      [keys.filterDateRange]: 'Datumsbereich',
      [keys.addFilter]: '+ Filter hinzufügen',
      [keys.apply]: 'Anwenden',
      [keys.clearAll]: 'Alle löschen',

      // Editors shared
      [keys.selectPlaceholder]: '— Auswählen —',
      [keys.done]: 'Fertig',

      // Date range editor
      [keys.dateFrom]: 'Von',
      [keys.dateTo]: 'Bis',
      [keys.startDate]: 'Startdatum…',
      [keys.endDate]: 'Enddatum…',

      // Single value editor
      [keys.groupPlaceholder]: 'Gruppen-ID…',
      [keys.orEnterId]: 'oder ID manuell eingeben',
      [keys.selectCollectionHint]: 'Wählen Sie einen Kollektionsfilter für die Suche',
      [keys.documentIdPlaceholder]: 'Dokument-ID…',
      [keys.update]: 'Aktualisieren',
      [keys.add]: 'Hinzufügen',
      [keys.selectEventPlaceholder]: '— Ereignis auswählen —',
      [keys.eventTypePlaceholder]: 'Ereignistyp…',
      [keys.fieldPathPlaceholder]: 'Feldpfad…',

      // User filter editor
      [keys.selectCollectionPlaceholder]: 'Kollektion auswählen…',
      [keys.userIdPlaceholder]: 'Benutzer-ID…',

      // Doc select
      [keys.searchPlaceholder]: 'Suchen…',

      // Log row
      [keys.metaIp]: 'IP',
      [keys.metaUa]: 'UA',
      [keys.metaLocale]: 'Sprache',
      [keys.sectionSnapshot]: 'Snapshot',
      [keys.sectionAuthEvent]: 'Auth-Ereignis',
      [keys.sectionCustomEvent]: 'Benutzerdefiniertes Ereignis',
      [keys.viewGlobal]: 'Global anzeigen →',
      [keys.viewDocument]: 'Dokument anzeigen →',
      [keys.fieldsChanged]: '{{count}} Feld',
      [keys.fieldsChangedPlural]: '{{count}} Felder',

      // Diff viewer
      [keys.diffPath]: 'Pfad',
      [keys.diffBefore]: 'Vorher',
      [keys.diffAfter]: 'Nachher',

      // Auth events
      [keys.authEventLogin]: 'Anmeldung',
      [keys.authEventForgotPassword]: 'Passwort vergessen',
    }

