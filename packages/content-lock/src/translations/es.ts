import { keys, type TranslationKey } from './keys'

/** Spanish values, keyed by the typed constants in `keys.ts` (see `en.ts`). */
export const es: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Bloqueo de contenido',
	[keys.collectionSingular]: 'Bloqueo de contenido',
	[keys.collectionPlural]: 'Bloqueos de contenido',

	[keys.fieldTitle]: 'Título',
	[keys.fieldAnnounceAt]: 'Anunciar desde',
	[keys.fieldAnnounceAtDescription]:
		'Cuándo empieza a mostrarse el banner programado. Déjalo vacío para no anunciarlo.',
	[keys.fieldStartsAt]: 'Empieza el',
	[keys.fieldStartsAtDescription]: 'Déjalo vacío para bloquear el contenido de inmediato.',
	[keys.fieldEndAtTime]: 'Terminar a una hora fija',
	[keys.fieldEndsAt]: 'Termina el',
	[keys.fieldEndedAt]: 'Finalizó el',
	[keys.fieldLockEverything]: 'Bloquear todo',
	[keys.fieldLockEverythingDescription]:
		'Desactívalo para bloquear solo el contenido seleccionado.',
	[keys.fieldGroups]: 'Grupos',
	[keys.fieldCollections]: 'Colecciones',
	[keys.fieldGlobals]: 'Globales',
	[keys.fieldMessage]: 'Mensaje',
	[keys.fieldMessageDescription]:
		'Texto opcional que se muestra en el banner bajo el aviso predeterminado.',
	[keys.fieldStatus]: 'Estado',
	[keys.statusPending]: 'Pendiente',
	[keys.statusAnnounced]: 'Anunciado',
	[keys.statusActive]: 'Activo',
	[keys.statusEnded]: 'Finalizado',

	[keys.dateBlockLabel]: 'Fecha',
	[keys.dateBlockDate]: 'Fecha y hora',
	[keys.dateBlockFormat]: 'Formato',
	[keys.formatDatetime]: 'Fecha y hora',
	[keys.formatDate]: 'Fecha',
	[keys.formatTime]: 'Hora',
	[keys.formatRelative]: 'Relativo',

	[keys.errorAnnounceAfterStart]: 'El anuncio debe empezar antes que el bloqueo.',
	[keys.errorEndBeforeStart]: 'El bloqueo debe terminar después de empezar.',
	[keys.errorEndsAtRequired]: 'Indica cuándo termina el bloqueo.',
	[keys.errorTargetsRequired]: 'Elige al menos un elemento para bloquear.',
	[keys.errorEndedReadOnly]: 'Un bloqueo finalizado ya no se puede modificar.',
	[keys.errorActiveStartMoved]:
		'Un bloqueo activo no se puede mover al futuro. Finalízalo y programa uno nuevo.',
	[keys.errorLocked]:
		'El contenido está bloqueado por mantenimiento. Inténtalo de nuevo más tarde.',

	[keys.bannerAnnouncedTitle]: 'Mantenimiento programado',
	[keys.bannerActiveTitle]: 'Mantenimiento en curso',
	[keys.bannerAnnouncedEverything]: 'El contenido será de solo lectura.',
	[keys.bannerActiveEverything]: 'El contenido es de solo lectura.',
	[keys.bannerAnnouncedPartial]: 'Será de solo lectura: {{what}}.',
	[keys.bannerActivePartial]: 'Solo lectura: {{what}}.',
	[keys.bannerFrom]: 'Desde',
	[keys.bannerUntil]: 'Hasta',
	[keys.bannerEndsIn]: 'Termina en {{time}}',
	[keys.bannerDismiss]: 'Descartar',

	[keys.actionLockNow]: 'Bloquear ahora',
	[keys.actionLockNowTitle]: 'Bloqueo no planificado',
	[keys.actionEndNow]: 'Finalizar ahora',
	[keys.actionFailed]: 'No se pudo actualizar el bloqueo.',
	[keys.confirmLockNowHeading]: '¿Bloquear todo el contenido ahora?',
	[keys.confirmLockNowBody]:
		'Todos pierden el acceso de escritura de inmediato, hasta que alguien finalice este bloqueo.',
	[keys.confirmEndNowHeading]: '¿Finalizar este bloqueo ahora?',
	[keys.confirmEndNowBody]:
		'El contenido afectado por este bloqueo vuelve a ser editable de inmediato.',
}
