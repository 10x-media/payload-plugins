import { AuditRelationshipField as AuditRelationshipField_5c28b1512d6ec4c987757370028f660d } from '@10x-media/audit-logs/client'
import { ImpersonationDocumentButton as ImpersonationDocumentButton_29b217e54847fa4511622a965ae4f895 } from '@10x-media/impersonation/client'
import { WatchTenantCollection as WatchTenantCollection_1d0591e3cf4f332c83a86da13a0de59a } from '@payloadcms/plugin-multi-tenant/client'
import { TenantField as TenantField_1d0591e3cf4f332c83a86da13a0de59a } from '@payloadcms/plugin-multi-tenant/client'
import { AssignTenantFieldTrigger as AssignTenantFieldTrigger_1d0591e3cf4f332c83a86da13a0de59a } from '@payloadcms/plugin-multi-tenant/client'
import { EndSessionMenuItem as EndSessionMenuItem_29b217e54847fa4511622a965ae4f895 } from '@10x-media/impersonation/client'
import { GlobalViewRedirect as GlobalViewRedirect_d6d5f193a167989e2ee7d14202901e62 } from '@payloadcms/plugin-multi-tenant/rsc'
import { ImpersonationAction as ImpersonationAction_59e9dfcbfaee95b3a2ecff56d5d216e8 } from '@10x-media/impersonation/rsc'
import { AuditLogsNav as AuditLogsNav_1a088299321e4555800ea9a0a9bd6645 } from '../../../components/AuditLogsNav'
import { TenantSelector as TenantSelector_d6d5f193a167989e2ee7d14202901e62 } from '@payloadcms/plugin-multi-tenant/rsc'
import { TenantSelectionProvider as TenantSelectionProvider_d6d5f193a167989e2ee7d14202901e62 } from '@payloadcms/plugin-multi-tenant/rsc'
import { ImpersonationProvider as ImpersonationProvider_59e9dfcbfaee95b3a2ecff56d5d216e8 } from '@10x-media/impersonation/rsc'
import { AuditLogsView as AuditLogsView_d109efa364f92f646cad8031879d6db3 } from '@10x-media/audit-logs/rsc'
import { CollectionCards as CollectionCards_f9c02e79a4aed9a3924487c0cd4cafb1 } from '@payloadcms/next/rsc'
import { RefundEvent as RefundEvent_c5043e5dbb4333de30960340700b913f } from '../../../components/RefundEvent'

/** @type import('payload').ImportMap */
export const importMap = {
  "@10x-media/audit-logs/client#AuditRelationshipField": AuditRelationshipField_5c28b1512d6ec4c987757370028f660d,
  "@10x-media/impersonation/client#ImpersonationDocumentButton": ImpersonationDocumentButton_29b217e54847fa4511622a965ae4f895,
  "@payloadcms/plugin-multi-tenant/client#WatchTenantCollection": WatchTenantCollection_1d0591e3cf4f332c83a86da13a0de59a,
  "@payloadcms/plugin-multi-tenant/client#TenantField": TenantField_1d0591e3cf4f332c83a86da13a0de59a,
  "@payloadcms/plugin-multi-tenant/client#AssignTenantFieldTrigger": AssignTenantFieldTrigger_1d0591e3cf4f332c83a86da13a0de59a,
  "@10x-media/impersonation/client#EndSessionMenuItem": EndSessionMenuItem_29b217e54847fa4511622a965ae4f895,
  "@payloadcms/plugin-multi-tenant/rsc#GlobalViewRedirect": GlobalViewRedirect_d6d5f193a167989e2ee7d14202901e62,
  "@10x-media/impersonation/rsc#ImpersonationAction": ImpersonationAction_59e9dfcbfaee95b3a2ecff56d5d216e8,
  "/components/AuditLogsNav#AuditLogsNav": AuditLogsNav_1a088299321e4555800ea9a0a9bd6645,
  "@payloadcms/plugin-multi-tenant/rsc#TenantSelector": TenantSelector_d6d5f193a167989e2ee7d14202901e62,
  "@payloadcms/plugin-multi-tenant/rsc#TenantSelectionProvider": TenantSelectionProvider_d6d5f193a167989e2ee7d14202901e62,
  "@10x-media/impersonation/rsc#ImpersonationProvider": ImpersonationProvider_59e9dfcbfaee95b3a2ecff56d5d216e8,
  "@10x-media/audit-logs/rsc#AuditLogsView": AuditLogsView_d109efa364f92f646cad8031879d6db3,
  "@payloadcms/next/rsc#CollectionCards": CollectionCards_f9c02e79a4aed9a3924487c0cd4cafb1,
  "/components/RefundEvent#RefundEvent": RefundEvent_c5043e5dbb4333de30960340700b913f
}
