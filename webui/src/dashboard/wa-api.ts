import { ACCOUNT_PAGE_SIZE, api, fetchAccountList } from '@byte-v-forge/common-ui';
import type { RequestAccountEmailOtpResponse, SetAccountEmailResponse, SetTwoFactorAuthSettingsResponse, VerifyAccountEmailOtpResponse } from '../proto/byte/v/forge/waapp/v1/account_settings';
import type { ListAccountOtpMessagesResponse } from '../proto/byte/v/forge/waapp/v1/extraction';
import type { GetLongConnectionStatusResponse, LongConnectionState } from '../proto/byte/v/forge/waapp/v1/messaging';
import type { DeleteWAAccountResponse, ListWAAccountsResponse, WAAccount } from '../proto/byte/v/forge/waapp/v1/profile';

export type WaPhoneInput = {
  workspace_id: string;
  region: string;
  phone: string;
  e164_number: string;
  country_calling_code: string;
  country_iso2: string;
};

export type WaWorkflowResponse = {
  success?: boolean;
  passed?: boolean;
  request_failed?: boolean;
  status?: string;
  error_message?: string;
  phone_status?: Record<string, unknown>;
  account_probe?: Record<string, unknown>;
  sms_probe?: Record<string, unknown>;
  phone?: Record<string, unknown>;
  proxy?: Record<string, unknown>;
  registration?: Record<string, unknown>;
  login_state?: Record<string, unknown>;
  check?: Record<string, unknown>;
};

export type WaConnectionState = LongConnectionState;
export type WaConnectionFilters = {
  login_state_id?: string;
  wa_account_id?: string;
  client_profile_id?: string;
  registered_identity_id?: string;
};
export type WaAccountProjection = WAAccount;

export const waKeys = {
  accounts: (workspaceId: string) => ['wa', 'accounts', workspaceId] as const,
  otpMessages: (workspaceId: string, waAccountId: string) => ['wa', 'otp-messages', workspaceId, waAccountId] as const,
  connections: (workspaceId: string, filters: WaConnectionFilters = {}) => ['wa', 'connections', workspaceId, filters.login_state_id || '', filters.wa_account_id || '', filters.client_profile_id || '', filters.registered_identity_id || ''] as const
};

export function getWaConnections(workspaceId: string, filters: WaConnectionFilters = {}) {
  const params = new URLSearchParams({ workspace_id: workspaceId || 'default' });
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  return api<GetLongConnectionStatusResponse>(`/api/wa/long-connections?${params.toString()}`);
}

export function getWaAccounts(workspaceId: string, cursor = '') {
  return fetchAccountList<WAAccount, ListWAAccountsResponse>({
    path: '/api/wa/accounts',
    cursor,
    limit: ACCOUNT_PAGE_SIZE,
    params: { workspace_id: workspaceId || 'default' }
  });
}

export function getWaAccountOtpMessages(workspaceId: string, waAccountId: string, cursor = '') {
  const params = new URLSearchParams({
    workspace_id: workspaceId || 'default',
    wa_account_id: waAccountId,
    limit: '20'
  });
  if (cursor) params.set('cursor', cursor);
  return api<ListAccountOtpMessagesResponse>(`/api/wa/account-otp-messages?${params.toString()}`);
}

export async function deleteWaAccount(account: WAAccount | string, workspaceId = 'default') {
  const accountID = typeof account === 'string' ? account : account.account?.key?.account_id || '';
  if (!accountID) throw new Error('wa_account_id is required');
  const params = new URLSearchParams({ workspace_id: workspaceId || 'default' });
  const resp = await api<DeleteWAAccountResponse>(`/api/wa/accounts/${encodeURIComponent(accountID)}?${params.toString()}`, { method: 'DELETE' });
  if (!resp.success || resp.error?.message) throw new Error(resp.error?.message || 'delete WAAccount failed');
  return resp;
}

export function probeWaPhoneSMS(input: WaPhoneInput) {
  return api<WaWorkflowResponse>('/api/wa/phone/sms-probe', { method: 'POST', body: JSON.stringify(input) });
}


export function registerWaPhone(input: WaPhoneInput) {
  return api<WaWorkflowResponse>('/api/wa/register', { method: 'POST', body: JSON.stringify(input) });
}

export function submitWaRegistrationOTP(account: WAAccount, otp: string, workspaceId = 'default') {
  const payload = waAccountActionPayload(account, workspaceId);
  return api<WaWorkflowResponse>('/api/wa/actions/registration/resume-otp', {
    method: 'POST',
    body: JSON.stringify({ workspace_id: payload.workspace_id, wa_account_id: payload.wa_account_id, otp }),
  });
}

export function checkWaLoginState(input: { workspace_id?: string; login_state_id?: string; registered_identity_id?: string; wa_account_id?: string; client_profile_id?: string; remote_timeout_seconds?: number }) {
  return api<WaWorkflowResponse>('/api/wa/login-state-check', { method: 'POST', body: JSON.stringify(input) });
}

export async function setWaTwoFactorAuthSettings(account: WAAccount, input: { pin: string; recovery_email?: string }, workspaceId = 'default') {
  const resp = await api<SetTwoFactorAuthSettingsResponse>('/api/wa/account-settings/2fa', {
    method: 'POST',
    body: JSON.stringify({ ...waAccountSettingsPayload(account, workspaceId), pin: input.pin, recovery_email: input.recovery_email || '' }),
  });
  return requireAccountSettingsResponse(resp);
}

export async function setWaAccountEmail(account: WAAccount, input: { email_address: string; google_id_token?: string }, workspaceId = 'default') {
  const resp = await api<SetAccountEmailResponse>('/api/wa/account-settings/email', {
    method: 'POST',
    body: JSON.stringify({ ...waAccountSettingsPayload(account, workspaceId), email_address: input.email_address, google_id_token: input.google_id_token || '' }),
  });
  return requireAccountSettingsResponse(resp);
}

export async function requestWaAccountEmailOtp(account: WAAccount, workspaceId = 'default') {
  const resp = await api<RequestAccountEmailOtpResponse>('/api/wa/account-settings/email/otp/request', {
    method: 'POST',
    body: JSON.stringify({ ...waAccountSettingsPayload(account, workspaceId), locale_language: 'en', locale_country: 'US' }),
  });
  return requireAccountSettingsResponse(resp);
}

export async function verifyWaAccountEmailOtp(account: WAAccount, code: string, workspaceId = 'default') {
  const resp = await api<VerifyAccountEmailOtpResponse>('/api/wa/account-settings/email/otp/verify', {
    method: 'POST',
    body: JSON.stringify({ ...waAccountSettingsPayload(account, workspaceId), code }),
  });
  return requireAccountSettingsResponse(resp);
}

function waAccountActionPayload(account: WAAccount, workspaceId: string) {
  const phone = account.phone;
  if (!phone?.e164_number || !phone.country_calling_code) throw new Error('WAAccount phone is incomplete');
  return {
    workspace_id: account.workspace_id || workspaceId,
    wa_account_id: account.account?.key?.account_id || '',
    phone,
  };
}

function waAccountSettingsPayload(account: WAAccount, workspaceId: string) {
  const accountID = account.account?.key?.account_id || '';
  if (!accountID) throw new Error('wa_account_id is required');
  return { workspace_id: account.workspace_id || workspaceId, wa_account_id: accountID };
}

function requireAccountSettingsResponse<T extends { error?: { message?: string }; operation?: { error?: { message?: string } } }>(resp: T) {
  const message = resp.error?.message || resp.operation?.error?.message;
  if (message) throw new Error(message);
  return resp;
}
