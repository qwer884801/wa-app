import { Copy, Smartphone } from 'lucide-react';
import {
  AccountCarrierManualOTPSubmit,
  AccountDangerZone,
  AccountDetails,
  Badge,
  Button,
  accountId,
  accountSubjectRenderConfig,
  buttonHint,
  copyText,
  useQuery,
  type AccountManagementDetailTab,
  type AccountRecord,
} from '@byte-v-forge/common-ui';
import { WaOtpSource } from '@byte-v-forge/common-ui/proto/byte/v/forge/contracts/wa/v1/wa';
import type { OtpMessage } from '../proto/byte/v/forge/waapp/v1/extraction';
import type { WaAccountProjection } from './wa-api';
import { getWaAccountOtpMessages, submitWaRegistrationOTP, waKeys } from './wa-api';
import { WaAccountSecurityPanel } from './wa-account-security';

const ACCOUNT_WORKSPACE_ID = 'default';

export function waAccountDetailTabs(options: {
  busy: boolean;
  onDelete: (account: WaAccountProjection) => void | Promise<void>;
  onManualOTPDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  return (carrier: WaAccountProjection, account: AccountRecord): AccountManagementDetailTab[] => [
    {
      value: 'details',
      label: '账户详情',
      content: (
        <WaAccountOverview
          carrier={carrier}
          account={account}
          busy={options.busy}
          onDelete={options.onDelete}
          onManualOTPDone={options.onManualOTPDone}
          onError={options.onError}
        />
      ),
    },
    {
      value: 'security',
      label: '安全/邮箱',
      content: <WaAccountSecurityPanel account={carrier} onDone={options.onManualOTPDone} onError={options.onError} />,
    },
    { value: 'otp', label: 'OTP 历史', content: <WaOtpHistory account={account} /> },
  ];
}

function WaAccountOverview(props: {
  carrier: WaAccountProjection;
  account: AccountRecord;
  busy: boolean;
  onDelete: (account: WaAccountProjection) => void | Promise<void>;
  onManualOTPDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  return (
    <div className="grid gap-0">
      <div className="grid gap-3 p-4 pb-0">
        <AccountCarrierManualOTPSubmit
          account={props.carrier}
          keyPrefix="wa-manual-otp"
          subtitle="添加并发起注册后，在这里提交收到的 OTP，完成当前等待中的注册流程。"
          disabled={props.busy}
          submit={submitWaRegistrationOTP}
          onSuccess={(resp) => {
            if (resp.error_message || resp.success === false) {
              throw new Error(resp.error_message || 'OTP 提交失败');
            }
            props.onManualOTPDone('OTP 已提交到等待中的注册流程');
          }}
          onError={(error) => props.onError(error instanceof Error ? error.message : String(error))}
        />
      </div>
      <AccountDetails
        account={props.account}
        config={accountSubjectRenderConfig({
          icon: () => <Smartphone size={15} />,
          showSubtitle: false,
          showStatusMeta: false,
        })}
      />
      <div className="px-4 pb-4">
        <AccountDangerZone account={props.carrier} busy={props.busy} onDelete={props.onDelete} />
      </div>
    </div>
  );
}

function WaOtpHistory({ account }: { account: AccountRecord }) {
  const waAccountId = accountId(account);
  const query = useQuery({
    queryKey: waKeys.otpMessages(ACCOUNT_WORKSPACE_ID, waAccountId),
    queryFn: () => getWaAccountOtpMessages(ACCOUNT_WORKSPACE_ID, waAccountId),
    enabled: Boolean(waAccountId),
    refetchInterval: 10000,
  });
  const messages = query.data?.otp_messages || [];
  return (
    <section className="grid gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">OTP 历史</h3>
        <Badge variant="outline">{messages.length} 条</Badge>
      </div>
      {renderOtpHistoryBody(query.isLoading, messages)}
      {query.data?.error?.message && <p className="text-xs text-destructive">{query.data.error.message}</p>}
    </section>
  );
}

function renderOtpHistoryBody(loading: boolean, messages: OtpMessage[]) {
  if (loading) {
    return <div className="rounded-xl border bg-card p-3 text-sm text-muted-foreground">加载 OTP 历史...</div>;
  }
  if (messages.length === 0) {
    return <div className="rounded-xl border bg-card p-3 text-sm text-muted-foreground">暂无 OTP 历史</div>;
  }
  return <div className="grid gap-2">{messages.map((item) => <WaOtpHistoryRow key={item.otp_message_id} item={item} />)}</div>;
}

function WaOtpHistoryRow({ item }: { item: OtpMessage }) {
  const sender = sourcePartyLabel(item.source_party);
  return (
    <div className="grid gap-1 rounded-xl border bg-card p-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-base">{item.otp?.value || item.otp?.redacted_value || '-'}</span>
        <Badge variant="outline">{otpSourceLabel(item.source)}</Badge>
      </div>
      <div className="grid gap-1 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <span>发送方：{sender.label}</span>
          {sender.detail && <code className="rounded bg-muted px-1 font-mono">{sender.detail}</code>}
          {item.source_party && <CopySourceButton value={item.source_party} />}
        </div>
        <span>接收时间：{formatTime(item.received_at)}</span>
      </div>
    </div>
  );
}

function CopySourceButton({ value }: { value: string }) {
  return (
    <Button
      className="h-5 px-1"
      variant="ghost"
      {...buttonHint('复制发送方标识')}
      onClick={() => {
        void copyText(value);
      }}
    >
      <Copy size={12} />
    </Button>
  );
}

function sourcePartyLabel(value?: string) {
  const raw = (value || '').trim();
  if (!raw) return { label: '-', detail: '' };
  if (raw === 's.whatsapp.net') return { label: 'WhatsApp 系统', detail: '' };
  if (raw.endsWith('@lid')) return { label: 'WA LID（未解析联系人）', detail: raw.replace(/@lid$/, '') };
  if (raw.endsWith('@g.us')) return { label: 'WA 群组', detail: raw };
  if (raw.endsWith('@s.whatsapp.net')) return { label: 'WA 号码', detail: `+${raw.replace(/@s\.whatsapp\.net$/, '')}` };
  return { label: 'WA 标识', detail: raw };
}

function otpSourceLabel(source: WaOtpSource | undefined) {
  switch (source) {
    case WaOtpSource.WA_OTP_SOURCE_LONG_CONNECTION:
      return '长连接';
    case WaOtpSource.WA_OTP_SOURCE_IMPORTED_HISTORY:
      return '导入历史';
    case WaOtpSource.WA_OTP_SOURCE_AUTO_EXTRACTION:
      return '自动解析';
    default:
      return '未知';
  }
}

function formatTime(value?: string) {
  if (!value) return '-';
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? value : time.toLocaleString();
}
