import { WatchTenantCollection as WatchTenantCollection_1d0591e3cf4f332c83a86da13a0de59a } from '@payloadcms/plugin-multi-tenant/client'
import { SettingsFormModifiedReporter as SettingsFormModifiedReporter_1fb8679bfe5063cdde30d578d88dd0b3 } from '@10x-media/settings-overlay/client'
import { SettingsOverlayDocumentActions as SettingsOverlayDocumentActions_1fb8679bfe5063cdde30d578d88dd0b3 } from '@10x-media/settings-overlay/client'
import { TenantField as TenantField_1d0591e3cf4f332c83a86da13a0de59a } from '@payloadcms/plugin-multi-tenant/client'
import { OverlayActions as OverlayActions_57defa397b036b761226b3d0979b5ea2 } from '../../../components/OverlayActions'
import { GlobalViewRedirect as GlobalViewRedirect_d6d5f193a167989e2ee7d14202901e62 } from '@payloadcms/plugin-multi-tenant/rsc'
import { TenantSelector as TenantSelector_d6d5f193a167989e2ee7d14202901e62 } from '@payloadcms/plugin-multi-tenant/rsc'
import { OverlayLaunchers as OverlayLaunchers_43572418a698b10c2ea3682eebeac3e1 } from '../../../components/OverlayLaunchers'
import { TenantSelectionProvider as TenantSelectionProvider_d6d5f193a167989e2ee7d14202901e62 } from '@payloadcms/plugin-multi-tenant/rsc'
import { SettingsOverlayServer as SettingsOverlayServer_28feb8b8fbe291f0ccca412236a9ab06 } from '@10x-media/settings-overlay/rsc'
import { DevReportView as DevReportView_c24a94462276709871a96ff550bd4452 } from '../../../components/DevReportView'
import { SettingsOverlayItemDispatcher as SettingsOverlayItemDispatcher_28feb8b8fbe291f0ccca412236a9ab06 } from '@10x-media/settings-overlay/rsc'
import { CollectionCards as CollectionCards_f9c02e79a4aed9a3924487c0cd4cafb1 } from '@payloadcms/next/rsc'
import { SettingsOverlayButton as SettingsOverlayButton_1fb8679bfe5063cdde30d578d88dd0b3 } from '@10x-media/settings-overlay/client'
import { GearIcon as GearIcon_b91e6e49555f836da067d089386c0422 } from '../../../components/icons'
import { SettingsOverlayAppearance as SettingsOverlayAppearance_73b931a31e79d1efadf0428488bdb3fb } from '@10x-media/settings-overlay/items'
import { DevNotes as DevNotes_98cf264105f371bef869b1e619ddef37 } from '../../../components/DevNotes'
import { DevStats as DevStats_19123d78607b4e120df51ce8e702d38d } from '../../../components/DevStats'
import { StudioEmpty as StudioEmpty_60ba93de2e4d6ae70512d2f0cf9d30f7 } from '../../../components/studio/StudioEmpty'
import { StudioHeader as StudioHeader_18b6db0d000861f3f1fac738de036ba2 } from '../../../components/studio/StudioHeader'
import { StudioRailGroup as StudioRailGroup_22bd92f7511e05e687561f7b0dc75515 } from '../../../components/studio/StudioRailGroup'
import { StudioRailItem as StudioRailItem_47cef5bf0952b83e5360805a1b28d30d } from '../../../components/studio/StudioRailItem'
import { StudioSearch as StudioSearch_dd19464f51ceb101bf2f38139201a953 } from '../../../components/studio/StudioSearch'

/** @type import('payload').ImportMap */
export const importMap = {
  "@payloadcms/plugin-multi-tenant/client#WatchTenantCollection": WatchTenantCollection_1d0591e3cf4f332c83a86da13a0de59a,
  "@10x-media/settings-overlay/client#SettingsFormModifiedReporter": SettingsFormModifiedReporter_1fb8679bfe5063cdde30d578d88dd0b3,
  "@10x-media/settings-overlay/client#SettingsOverlayDocumentActions": SettingsOverlayDocumentActions_1fb8679bfe5063cdde30d578d88dd0b3,
  "@payloadcms/plugin-multi-tenant/client#TenantField": TenantField_1d0591e3cf4f332c83a86da13a0de59a,
  "./components/OverlayActions#OverlayActions": OverlayActions_57defa397b036b761226b3d0979b5ea2,
  "@payloadcms/plugin-multi-tenant/rsc#GlobalViewRedirect": GlobalViewRedirect_d6d5f193a167989e2ee7d14202901e62,
  "@payloadcms/plugin-multi-tenant/rsc#TenantSelector": TenantSelector_d6d5f193a167989e2ee7d14202901e62,
  "./components/OverlayLaunchers#OverlayLaunchers": OverlayLaunchers_43572418a698b10c2ea3682eebeac3e1,
  "@payloadcms/plugin-multi-tenant/rsc#TenantSelectionProvider": TenantSelectionProvider_d6d5f193a167989e2ee7d14202901e62,
  "@10x-media/settings-overlay/rsc#SettingsOverlayServer": SettingsOverlayServer_28feb8b8fbe291f0ccca412236a9ab06,
  "./components/DevReportView#DevReportView": DevReportView_c24a94462276709871a96ff550bd4452,
  "@10x-media/settings-overlay/rsc#SettingsOverlayItemDispatcher": SettingsOverlayItemDispatcher_28feb8b8fbe291f0ccca412236a9ab06,
  "@payloadcms/next/rsc#CollectionCards": CollectionCards_f9c02e79a4aed9a3924487c0cd4cafb1,
  "@10x-media/settings-overlay/client#SettingsOverlayButton": SettingsOverlayButton_1fb8679bfe5063cdde30d578d88dd0b3,
  "./components/icons#GearIcon": GearIcon_b91e6e49555f836da067d089386c0422,
  "@10x-media/settings-overlay/items#SettingsOverlayAppearance": SettingsOverlayAppearance_73b931a31e79d1efadf0428488bdb3fb,
  "./components/DevNotes#DevNotes": DevNotes_98cf264105f371bef869b1e619ddef37,
  "./components/DevStats#DevStats": DevStats_19123d78607b4e120df51ce8e702d38d,
  "./components/studio/StudioEmpty#StudioEmpty": StudioEmpty_60ba93de2e4d6ae70512d2f0cf9d30f7,
  "./components/studio/StudioHeader#StudioHeader": StudioHeader_18b6db0d000861f3f1fac738de036ba2,
  "./components/studio/StudioRailGroup#StudioRailGroup": StudioRailGroup_22bd92f7511e05e687561f7b0dc75515,
  "./components/studio/StudioRailItem#StudioRailItem": StudioRailItem_47cef5bf0952b83e5360805a1b28d30d,
  "./components/studio/StudioSearch#StudioSearch": StudioSearch_dd19464f51ceb101bf2f38139201a953
}
