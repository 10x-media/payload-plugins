import { AuditRelationshipField as AuditRelationshipField_5c28b1512d6ec4c987757370028f660d } from '@10x-media/audit-logs/client'
import { LLMInstructionsMenuItem as LLMInstructionsMenuItem_3817bf644402e67bfe6577f60ef982de } from '@payloadcms/ui'
import { ImpersonationDocumentButton as ImpersonationDocumentButton_29b217e54847fa4511622a965ae4f895 } from '@10x-media/impersonation/client'
import { WatchTenantCollection as WatchTenantCollection_1d0591e3cf4f332c83a86da13a0de59a } from '@payloadcms/plugin-multi-tenant/client'
import { TenantField as TenantField_1d0591e3cf4f332c83a86da13a0de59a } from '@payloadcms/plugin-multi-tenant/client'
import { AssignTenantFieldTrigger as AssignTenantFieldTrigger_1d0591e3cf4f332c83a86da13a0de59a } from '@payloadcms/plugin-multi-tenant/client'
import { EndSessionMenuItem as EndSessionMenuItem_29b217e54847fa4511622a965ae4f895 } from '@10x-media/impersonation/client'
import { LLMInstructionsDescription as LLMInstructionsDescription_3817bf644402e67bfe6577f60ef982de } from '@payloadcms/ui'
import { LLMInstructionsCell as LLMInstructionsCell_ab83ff7e88da8d3530831f296ec4756a } from '@payloadcms/ui/rsc'
import { ImpersonationHeader as ImpersonationHeader_29b217e54847fa4511622a965ae4f895 } from '@10x-media/impersonation/client'
import { GlobalViewRedirect as GlobalViewRedirect_d6d5f193a167989e2ee7d14202901e62 } from '@payloadcms/plugin-multi-tenant/rsc'
import { ImpersonationAction as ImpersonationAction_59e9dfcbfaee95b3a2ecff56d5d216e8 } from '@10x-media/impersonation/rsc'
import { AuditLogsNav as AuditLogsNav_1a088299321e4555800ea9a0a9bd6645 } from '../../../../dev/components/AuditLogsNav'
import { TenantSelector as TenantSelector_d6d5f193a167989e2ee7d14202901e62 } from '@payloadcms/plugin-multi-tenant/rsc'
import { TenantSelectionProvider as TenantSelectionProvider_d6d5f193a167989e2ee7d14202901e62 } from '@payloadcms/plugin-multi-tenant/rsc'
import { ImpersonationProvider as ImpersonationProvider_59e9dfcbfaee95b3a2ecff56d5d216e8 } from '@10x-media/impersonation/rsc'
import { AuditLogsView as AuditLogsView_d109efa364f92f646cad8031879d6db3 } from '@10x-media/audit-logs/rsc'
import { WelcomeWidget as WelcomeWidget_ab83ff7e88da8d3530831f296ec4756a } from '@payloadcms/ui/rsc'
import { CollectionCards as CollectionCards_ab83ff7e88da8d3530831f296ec4756a } from '@payloadcms/ui/rsc'
import { CollectionQueryWidget as CollectionQueryWidget_ab83ff7e88da8d3530831f296ec4756a } from '@payloadcms/ui/rsc'
import { QueryPresetsWhereField as QueryPresetsWhereField_3817bf644402e67bfe6577f60ef982de } from '@payloadcms/ui'
import { CollectionQuerySortField as CollectionQuerySortField_3817bf644402e67bfe6577f60ef982de } from '@payloadcms/ui'
import { ActivityWidget as ActivityWidget_ab83ff7e88da8d3530831f296ec4756a } from '@payloadcms/ui/rsc'
import { CollectionFilter as CollectionFilter_3817bf644402e67bfe6577f60ef982de } from '@payloadcms/ui'
import { UploadDropzoneWidget as UploadDropzoneWidget_ab83ff7e88da8d3530831f296ec4756a } from '@payloadcms/ui/rsc'
import { UploadDropzoneCollectionsField as UploadDropzoneCollectionsField_3817bf644402e67bfe6577f60ef982de } from '@payloadcms/ui'
import { RefundEvent as RefundEvent_c5043e5dbb4333de30960340700b913f } from '../../../../dev/components/RefundEvent'
import { RowStateNote as RowStateNote_60e8aa1b793c0e3f84013ce5ea2b1df1 } from '../../../../dev/components/audit/RowStateNote'
import { DepartmentBadges as DepartmentBadges_085a9d145775eca9d68c4c1ff02e6c68 } from '../../../../dev/components/audit/DepartmentBadges'
import { ActorPopover as ActorPopover_bd5bee2e8b2002fa530dbf920f5fce35 } from '../../../../dev/components/audit/ActorPopover'

/** @type import('payload').ImportMap */
export const importMap = {
  "@10x-media/audit-logs/client#AuditRelationshipField": AuditRelationshipField_5c28b1512d6ec4c987757370028f660d,
  "@payloadcms/ui#LLMInstructionsMenuItem": LLMInstructionsMenuItem_3817bf644402e67bfe6577f60ef982de,
  "@10x-media/impersonation/client#ImpersonationDocumentButton": ImpersonationDocumentButton_29b217e54847fa4511622a965ae4f895,
  "@payloadcms/plugin-multi-tenant/client#WatchTenantCollection": WatchTenantCollection_1d0591e3cf4f332c83a86da13a0de59a,
  "@payloadcms/plugin-multi-tenant/client#TenantField": TenantField_1d0591e3cf4f332c83a86da13a0de59a,
  "@payloadcms/plugin-multi-tenant/client#AssignTenantFieldTrigger": AssignTenantFieldTrigger_1d0591e3cf4f332c83a86da13a0de59a,
  "@10x-media/impersonation/client#EndSessionMenuItem": EndSessionMenuItem_29b217e54847fa4511622a965ae4f895,
  "@payloadcms/ui#LLMInstructionsDescription": LLMInstructionsDescription_3817bf644402e67bfe6577f60ef982de,
  "@payloadcms/ui/rsc#LLMInstructionsCell": LLMInstructionsCell_ab83ff7e88da8d3530831f296ec4756a,
  "@10x-media/impersonation/client#ImpersonationHeader": ImpersonationHeader_29b217e54847fa4511622a965ae4f895,
  "@payloadcms/plugin-multi-tenant/rsc#GlobalViewRedirect": GlobalViewRedirect_d6d5f193a167989e2ee7d14202901e62,
  "@10x-media/impersonation/rsc#ImpersonationAction": ImpersonationAction_59e9dfcbfaee95b3a2ecff56d5d216e8,
  "/components/AuditLogsNav#AuditLogsNav": AuditLogsNav_1a088299321e4555800ea9a0a9bd6645,
  "@payloadcms/plugin-multi-tenant/rsc#TenantSelector": TenantSelector_d6d5f193a167989e2ee7d14202901e62,
  "@payloadcms/plugin-multi-tenant/rsc#TenantSelectionProvider": TenantSelectionProvider_d6d5f193a167989e2ee7d14202901e62,
  "@10x-media/impersonation/rsc#ImpersonationProvider": ImpersonationProvider_59e9dfcbfaee95b3a2ecff56d5d216e8,
  "@10x-media/audit-logs/rsc#AuditLogsView": AuditLogsView_d109efa364f92f646cad8031879d6db3,
  "@payloadcms/ui/rsc#WelcomeWidget": WelcomeWidget_ab83ff7e88da8d3530831f296ec4756a,
  "@payloadcms/ui/rsc#CollectionCards": CollectionCards_ab83ff7e88da8d3530831f296ec4756a,
  "@payloadcms/ui/rsc#CollectionQueryWidget": CollectionQueryWidget_ab83ff7e88da8d3530831f296ec4756a,
  "@payloadcms/ui#QueryPresetsWhereField": QueryPresetsWhereField_3817bf644402e67bfe6577f60ef982de,
  "@payloadcms/ui#CollectionQuerySortField": CollectionQuerySortField_3817bf644402e67bfe6577f60ef982de,
  "@payloadcms/ui/rsc#ActivityWidget": ActivityWidget_ab83ff7e88da8d3530831f296ec4756a,
  "@payloadcms/ui#CollectionFilter": CollectionFilter_3817bf644402e67bfe6577f60ef982de,
  "@payloadcms/ui/rsc#UploadDropzoneWidget": UploadDropzoneWidget_ab83ff7e88da8d3530831f296ec4756a,
  "@payloadcms/ui#UploadDropzoneCollectionsField": UploadDropzoneCollectionsField_3817bf644402e67bfe6577f60ef982de,
  "/components/RefundEvent#RefundEvent": RefundEvent_c5043e5dbb4333de30960340700b913f,
  "/components/audit/RowStateNote#RowStateNote": RowStateNote_60e8aa1b793c0e3f84013ce5ea2b1df1,
  "/components/audit/DepartmentBadges#DepartmentBadges": DepartmentBadges_085a9d145775eca9d68c4c1ff02e6c68,
  "/components/audit/ActorPopover#ActorPopover": ActorPopover_bd5bee2e8b2002fa530dbf920f5fce35
}
