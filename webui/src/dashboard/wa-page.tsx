import { Smartphone } from 'lucide-react';
import {
  ACCOUNT_PAGE_SIZE,
  AccountManagementDrawerView,
  ToastMessage,
  accountCarrierID,
  accountId,
  accountSubjectRenderConfig,
  useAccountManagementController,
  useToastMessage,
  type AccountManagementController,
  type AccountManagementControllerOptions,
  type AccountRecord,
} from '@byte-v-forge/common-ui';
import type { ListWAAccountsResponse } from '../proto/byte/v/forge/waapp/v1/profile';
import { deleteWaAccount, getWaAccounts, waKeys, type WaAccountProjection } from './wa-api';
import { WaAccountAdd } from './wa-account-add';
import { waAccountDetailTabs } from './wa-account-detail';
import { WaLongConnectionBadge, useWaLongConnectionIndex } from './wa-long-connection-badge';

const ACCOUNT_WORKSPACE_ID = 'default';
const waAccountControllerOptions = {
  queryKey: waKeys.accounts(ACCOUNT_WORKSPACE_ID),
  queryFn: (cursor) => getWaAccounts(ACCOUNT_WORKSPACE_ID, cursor),
  refetchInterval: 10000,
  pageSize: ACCOUNT_PAGE_SIZE,
  clearMissingSelection: true,
} satisfies AccountManagementControllerOptions<WaAccountProjection, ListWAAccountsResponse>;

export function WaPage() {
  const toast = useToastMessage();
  const accounts = useAccountManagementController<WaAccountProjection, ListWAAccountsResponse>(waAccountControllerOptions);
  return (
    <>
      <ToastMessage toast={toast.toast} />
      <WaAccountsView
        controller={accounts}
        onAccountAdded={async () => {
          toast.showOK('WA 注册流程已发起，等待 OTP');
          await accounts.invalidate();
        }}
        onActionDone={toast.showOK}
        onError={toast.showError}
      />
    </>
  );
}

function WaAccountsView(props: {
  controller: AccountManagementController<WaAccountProjection, ListWAAccountsResponse>;
  onAccountAdded: () => void | Promise<void>;
  onActionDone: (message: string) => void;
  onError: (message: unknown) => void;
}) {
  const busy = props.controller.isLoading || props.controller.actionBusy;
  const connections = useWaLongConnectionIndex(ACCOUNT_WORKSPACE_ID);
  const renderConfig = {
    ...accountSubjectRenderConfig({ icon: () => <Smartphone size={15} /> }),
    meta: (account: AccountRecord) => (
      <WaLongConnectionBadge connection={connections.byAccount.get(accountId(account))} loading={connections.loading} />
    ),
  };
  async function deleteAccount(account: WaAccountProjection) {
    const accountID = accountCarrierID(account);
    await props.controller.deleteAccount(account, () => deleteWaAccount(account, ACCOUNT_WORKSPACE_ID), {
      actionID: 'wa-delete',
      confirmMessage: () => `删除 WAAccount ${accountID}？`,
      onSuccess: (deleted) => {
        if (deleted) props.onActionDone('WAAccount 已删除');
      },
      onError: props.onError,
    });
  }
  return (
    <AccountManagementDrawerView
      title={
        <span className="inline-flex items-center gap-2">
          <Smartphone className="size-4" />WA 管理
        </span>
      }
      icon={<Smartphone size={16} />}
      actions={<WaAccountAdd disabled={busy} onCreated={props.onAccountAdded} onError={(message) => props.onError(message)} />}
      carriers={props.controller.accounts}
      selectedCarrier={props.controller.selected}
      selectedID={props.controller.selectedID}
      onSelectCarrier={props.controller.selectAccount}
      loading={props.controller.isLoading}
      loadingText="加载 WAAccount..."
      emptyText="暂无已持久化 WAAccount；点击右上角添加并注册。"
      pagination={props.controller.accountsPagination}
      config={renderConfig}
      drawerDescription="WA 账号详情"
      detailTabs={waAccountDetailTabs({
        busy,
        onDelete: deleteAccount,
        onManualOTPDone: props.onActionDone,
        onError: props.onError,
      })}
      onCloseDetails={props.controller.clearSelection}
    />
  );
}
