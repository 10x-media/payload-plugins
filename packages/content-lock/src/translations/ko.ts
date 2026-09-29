import { keys, type TranslationKey } from './keys'

/** Korean values, keyed by the typed constants in `keys.ts` (see `en.ts`). */
export const ko: Record<TranslationKey, string> = {
	[keys.pluginName]: '콘텐츠 잠금',
	[keys.collectionSingular]: '콘텐츠 잠금',
	[keys.collectionPlural]: '콘텐츠 잠금',

	[keys.fieldTitle]: '제목',
	[keys.fieldAnnounceAt]: '공지 시작',
	[keys.fieldAnnounceAtDescription]:
		'예약된 배너가 표시되기 시작하는 시점입니다. 공지하지 않으려면 비워 두세요.',
	[keys.fieldStartsAt]: '시작 시각',
	[keys.fieldStartsAtDescription]: '비워 두면 콘텐츠가 즉시 잠깁니다.',
	[keys.fieldEndAtTime]: '지정된 시각에 종료',
	[keys.fieldEndsAt]: '종료 시각',
	[keys.fieldEndedAt]: '종료됨',
	[keys.fieldLockEverything]: '전체 잠금',
	[keys.fieldLockEverythingDescription]: '선택한 콘텐츠만 잠그려면 끄세요.',
	[keys.fieldGroups]: '그룹',
	[keys.fieldCollections]: '컬렉션',
	[keys.fieldGlobals]: '글로벌',
	[keys.fieldMessage]: '메시지',
	[keys.fieldMessageDescription]: '배너의 기본 안내 아래에 표시되는 선택 텍스트입니다.',
	[keys.fieldStatus]: '상태',
	[keys.statusPending]: '대기 중',
	[keys.statusAnnounced]: '공지됨',
	[keys.statusActive]: '활성',
	[keys.statusEnded]: '종료됨',

	[keys.dateBlockLabel]: '날짜',
	[keys.dateBlockDate]: '날짜 및 시간',
	[keys.dateBlockFormat]: '형식',
	[keys.formatDatetime]: '날짜 및 시간',
	[keys.formatDate]: '날짜',
	[keys.formatTime]: '시간',
	[keys.formatRelative]: '상대 시간',

	[keys.errorAnnounceAfterStart]: '공지는 잠금보다 먼저 시작해야 합니다.',
	[keys.errorEndBeforeStart]: '잠금은 시작 이후에 종료되어야 합니다.',
	[keys.errorEndsAtRequired]: '잠금 종료 시각을 설정하세요.',
	[keys.errorTargetsRequired]: '잠글 항목을 하나 이상 선택하세요.',
	[keys.errorEndedReadOnly]: '종료된 잠금은 더 이상 변경할 수 없습니다.',
	[keys.errorActiveStartMoved]:
		'활성 잠금은 미래로 옮길 수 없습니다. 잠금을 종료하고 새로 예약하세요.',
	[keys.errorLocked]: '유지보수를 위해 콘텐츠가 잠겨 있습니다. 나중에 다시 시도하세요.',

	[keys.bannerAnnouncedTitle]: '예정된 유지보수',
	[keys.bannerActiveTitle]: '유지보수 진행 중',
	[keys.bannerAnnouncedEverything]: '콘텐츠가 읽기 전용이 됩니다.',
	[keys.bannerActiveEverything]: '콘텐츠가 읽기 전용입니다.',
	[keys.bannerAnnouncedPartial]: '읽기 전용 예정: {{what}}.',
	[keys.bannerActivePartial]: '읽기 전용: {{what}}.',
	[keys.bannerFrom]: '시작',
	[keys.bannerUntil]: '종료',
	[keys.bannerEndsIn]: '{{time}} 후 종료',
	[keys.bannerDismiss]: '닫기',

	[keys.actionLockNow]: '지금 잠그기',
	[keys.actionLockNowTitle]: '예정에 없던 잠금',
	[keys.actionEndNow]: '지금 종료',
	[keys.actionFailed]: '잠금을 업데이트할 수 없습니다.',
	[keys.confirmLockNowHeading]: '지금 모든 콘텐츠를 잠글까요?',
	[keys.confirmLockNowBody]:
		'누군가 이 잠금을 종료할 때까지 모든 사용자의 쓰기 권한이 즉시 해제됩니다.',
	[keys.confirmEndNowHeading]: '지금 이 잠금을 종료할까요?',
	[keys.confirmEndNowBody]: '이 잠금이 적용된 콘텐츠를 즉시 다시 편집할 수 있습니다.',
}
