import { keys, type TranslationKey } from './keys'

/** Portuguese values, keyed by the typed constants in `keys.ts` (see `en.ts`). */
export const pt: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Bloqueio de conteúdo',
	[keys.collectionSingular]: 'Bloqueio de conteúdo',
	[keys.collectionPlural]: 'Bloqueios de conteúdo',

	[keys.fieldTitle]: 'Título',
	[keys.fieldAnnounceAt]: 'Anunciar a partir de',
	[keys.fieldAnnounceAtDescription]:
		'Quando o banner programado começa a ser exibido. Deixe vazio para não anunciar.',
	[keys.fieldStartsAt]: 'Começa em',
	[keys.fieldStartsAtDescription]: 'Deixe vazio para bloquear o conteúdo imediatamente.',
	[keys.fieldEndAtTime]: 'Encerrar em um horário definido',
	[keys.fieldEndsAt]: 'Termina em',
	[keys.fieldEndedAt]: 'Encerrado em',
	[keys.fieldLockEverything]: 'Bloquear tudo',
	[keys.fieldLockEverythingDescription]: 'Desative para bloquear apenas o conteúdo selecionado.',
	[keys.fieldGroups]: 'Grupos',
	[keys.fieldCollections]: 'Coleções',
	[keys.fieldGlobals]: 'Globais',
	[keys.fieldMessage]: 'Mensagem',
	[keys.fieldMessageDescription]: 'Texto opcional exibido no banner abaixo do aviso padrão.',
	[keys.fieldStatus]: 'Status',
	[keys.statusPending]: 'Pendente',
	[keys.statusAnnounced]: 'Anunciado',
	[keys.statusActive]: 'Ativo',
	[keys.statusEnded]: 'Encerrado',

	[keys.dateBlockLabel]: 'Data',
	[keys.dateBlockDate]: 'Data e hora',
	[keys.dateBlockFormat]: 'Formato',
	[keys.formatDatetime]: 'Data e hora',
	[keys.formatDate]: 'Data',
	[keys.formatTime]: 'Hora',
	[keys.formatRelative]: 'Relativo',

	[keys.errorAnnounceAfterStart]: 'O anúncio deve começar antes do bloqueio.',
	[keys.errorEndBeforeStart]: 'O bloqueio deve terminar depois de começar.',
	[keys.errorEndsAtRequired]: 'Defina quando o bloqueio termina.',
	[keys.errorTargetsRequired]: 'Escolha pelo menos um item para bloquear.',
	[keys.errorEndedReadOnly]: 'Um bloqueio encerrado não pode mais ser alterado.',
	[keys.errorActiveStartMoved]:
		'Um bloqueio ativo não pode ser movido para o futuro. Encerre-o e agende um novo.',
	[keys.errorLocked]: 'O conteúdo está bloqueado para manutenção. Tente novamente mais tarde.',

	[keys.bannerAnnouncedTitle]: 'Manutenção programada',
	[keys.bannerActiveTitle]: 'Manutenção em andamento',
	[keys.bannerAnnouncedEverything]: 'O conteúdo ficará somente leitura.',
	[keys.bannerActiveEverything]: 'O conteúdo está somente leitura.',
	[keys.bannerAnnouncedPartial]: 'Ficará somente leitura: {{what}}.',
	[keys.bannerActivePartial]: 'Somente leitura: {{what}}.',
	[keys.bannerFrom]: 'De',
	[keys.bannerUntil]: 'Até',
	[keys.bannerEndsIn]: 'Termina em {{time}}',
	[keys.bannerDismiss]: 'Dispensar',

	[keys.actionLockNow]: 'Bloquear agora',
	[keys.actionLockNowTitle]: 'Bloqueio não planejado',
	[keys.actionEndNow]: 'Encerrar agora',
	[keys.actionFailed]: 'Não foi possível atualizar o bloqueio.',
	[keys.confirmLockNowHeading]: 'Bloquear todo o conteúdo agora?',
	[keys.confirmLockNowBody]:
		'Todos perdem o acesso de escrita imediatamente, até que alguém encerre este bloqueio.',
	[keys.confirmEndNowHeading]: 'Encerrar este bloqueio agora?',
	[keys.confirmEndNowBody]:
		'O conteúdo coberto por este bloqueio volta a ser editável imediatamente.',
}
