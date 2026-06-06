import { useState } from 'react';
import { CheckCircle2, Search } from 'lucide-react';
import {
  AccountAddDialog,
  AccountPhoneFieldList,
  Alert,
  AlertDescription,
  Badge,
  Button,
  useAsyncActionRunner,
} from '@byte-v-forge/common-ui';
import type { UseFormReturn } from 'react-hook-form';
import { probeWaPhoneSMS, registerWaPhone, type WaWorkflowResponse } from './wa-api';
import { waProbeCanStartRegistration, waProbeStatus } from './wa-result-model';
import { WaResultPanel } from './wa-result-panel';
import { resolveWaPhoneTarget, type WaResolvedPhone } from './wa-utils';

type WaAddAccountValues = { phone: string; country_calling_code: string };
type ProbeState = { target: WaResolvedPhone; result: WaWorkflowResponse } | null;

export function WaAccountAdd({ disabled, onCreated, onError }: {
  disabled?: boolean;
  onCreated: () => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const [probe, setProbe] = useState<ProbeState>(null);
  const runner = useAsyncActionRunner();
  return (
    <AccountAddDialog<WaAddAccountValues>
      formId="wa-add-account-form"
      title="添加并注册 WAAccount"
      description="先检测手机号/SMS 状态；检测通过后发起注册；WA 成功进入 OTP 等待时才持久化账号。"
      defaultValues={{ phone: '', country_calling_code: '' }}
      disabled={disabled || runner.busy}
      submitLabel="发起注册"
      submittingLabel="注册中"
      submitDisabled={(values) => !probeMatchesValues(probe, values) || !waProbeCanStartRegistration(probe?.result) || runner.busy}
      onError={onError}
      onDone={async () => {
        setProbe(null);
        await onCreated();
      }}
      onSubmit={async (values) => {
        const target = requirePhoneTarget(values);
        if (!probeMatchesValues(probe, values) || !waProbeCanStartRegistration(probe?.result)) throw new Error('请先完成检测，且检测通过后才能发起注册。');
        const result = await registerWaPhone(target.input);
        if (result.success === false || result.error_message) throw new Error(result.error_message || result.status || 'WA 注册流程发起失败');
        return result;
      }}
    >
      {(form) => <WaAddRegistrationProbe form={form} probe={probe} busy={runner.busy} onProbe={(next) => setProbe(next)} onError={onError} runner={runner} />}
    </AccountAddDialog>
  );
}

function WaAddRegistrationProbe({ form, probe, busy, runner, onProbe, onError }: {
  form: UseFormReturn<WaAddAccountValues>;
  probe: ProbeState;
  busy?: boolean;
  runner: ReturnType<typeof useAsyncActionRunner>;
  onProbe: (probe: ProbeState) => void;
  onError: (message: string) => void;
}) {
  const values = form.watch();
  const samePhone = probeMatchesValues(probe, values);
  const status = waProbeStatus(samePhone ? probe?.result : null);
  const canRegister = samePhone && waProbeCanStartRegistration(probe?.result);
  return (
    <>
      <AccountPhoneFieldList control={form.control} idPrefix="wa-add" countryPlaceholder="+1" phonePlaceholder="4155550123" />
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => runProbe(values, runner, onProbe, onError)}>
          <Search size={14} /> 检测
        </Button>
        {canRegister && <Badge variant="default"><CheckCircle2 size={12} /> 可注册</Badge>}
        {probe && !samePhone && <Badge variant="outline">号码已变化，请重新检测</Badge>}
      </div>
      <Alert>
        <AlertDescription>{canRegister ? '检测通过，可以点击“发起注册”。发码成功后 WAAccount 会持久化，详情页可手动提交 OTP。' : '先检测手机号/SMS 状态；检测通过前不会持久化 WAAccount。'}</AlertDescription>
      </Alert>
      {(probe || busy) && <WaResultPanel title="检测结果" phone={samePhone ? probe?.target.e164 || '' : ''} result={samePhone ? probe?.result || null : null} loading={busy} />}
      {samePhone && status.requestFailed && <p className="text-xs text-destructive">{status.failureReason || '检测失败'}</p>}
    </>
  );
}

async function runProbe(values: WaAddAccountValues, runner: ReturnType<typeof useAsyncActionRunner>, onProbe: (probe: ProbeState) => void, onError: (message: string) => void) {
  const resolved = resolveWaPhoneTarget(values.phone, values.country_calling_code);
  if (!resolved.target) {
    onError(resolved.error || '请输入手机号和国家拨号码。');
    return;
  }
  const target = resolved.target;
  const result = await runner.tryRun('wa-add-phone-probe', () => probeWaPhoneSMS(target.input), {
    onError: (error) => onError(error instanceof Error ? error.message : String(error)),
  });
  if (result.ok) onProbe({ target, result: result.value });
}

function requirePhoneTarget(values: WaAddAccountValues) {
  const resolved = resolveWaPhoneTarget(values.phone, values.country_calling_code);
  if (!resolved.target) throw new Error(resolved.error || '请输入手机号和国家拨号码。');
  return resolved.target;
}

function probeMatchesValues(probe: ProbeState, values: WaAddAccountValues) {
  if (!probe) return false;
  try {
    return requirePhoneTarget(values).e164 === probe.target.e164;
  } catch {
    return false;
  }
}
