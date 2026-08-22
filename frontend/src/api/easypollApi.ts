import { requestJson } from './apiClient';
import type {
  ConnectionStatus, GroupMembersResponse, GroupsResponse, GroupSyncStatus,
  HistoryPreparationStatus, IncrementalSyncResult, LocalGroupsResponse,
  LogoutResponse, PersistedStatsResult, PollHistoryDetail, PollHistoryListResult,
  PollScanResult, ProfilePictureResponse, QrResponse, SendPollInput, SendPollResponse,
  SyncDirection
} from '../types/api';

const groupPath = (groupId: string) => `/api/groups/${encodeURIComponent(groupId)}`;

export const api = {
  status: (signal?: AbortSignal) => requestJson<ConnectionStatus>('/api/status', { signal }),
  qr: (signal?: AbortSignal) => requestJson<QrResponse>('/api/qr', { signal }),
  logout: () => requestJson<LogoutResponse>('/api/whatsapp/logout', { method: 'POST' }),
  groups: () => requestJson<GroupsResponse>('/api/groups'),
  localGroups: () => requestJson<LocalGroupsResponse>('/api/local/groups'),
  members: (groupId: string, signal?: AbortSignal) =>
    requestJson<GroupMembersResponse>(`${groupPath(groupId)}/members`, { signal }),
  profilePicture: (groupId: string, memberId: string, signal?: AbortSignal) =>
    requestJson<ProfilePictureResponse>(
      `${groupPath(groupId)}/members/${encodeURIComponent(memberId)}/profile-picture`, { signal }
    ),
  sendPoll: (input: SendPollInput) =>
    requestJson<SendPollResponse>('/api/polls', { method: 'POST', body: JSON.stringify(input) }),
  scanPolls: (groupId: string, limit: number, signal?: AbortSignal) =>
    requestJson<PollScanResult>(`${groupPath(groupId)}/polls/scan`, {
      method: 'POST', body: JSON.stringify({ limit }), signal
    }),
  syncStatus: (groupId: string) => requestJson<GroupSyncStatus>(`${groupPath(groupId)}/sync-status`),
  sync: (groupId: string, direction: SyncDirection, limit?: number) =>
    requestJson<IncrementalSyncResult>(`${groupPath(groupId)}/sync/${direction}`, {
      method: 'POST', ...(limit ? { body: JSON.stringify({ limit }) } : {})
    }),
  cancelSync: (groupId: string) =>
    requestJson<{ cancelled: boolean }>(`${groupPath(groupId)}/sync`, { method: 'DELETE' }),
  historyPreparationStatus: (groupId: string) =>
    requestJson<HistoryPreparationStatus>(`${groupPath(groupId)}/history/status`),
  prepareHistory: (groupId: string, target: number) =>
    requestJson<HistoryPreparationStatus>(`${groupPath(groupId)}/history/prepare`, {
      method: 'POST', body: JSON.stringify({ target })
    }),
  cancelHistoryPreparation: (groupId: string) =>
    requestJson<HistoryPreparationStatus>(`${groupPath(groupId)}/history/prepare`, { method: 'DELETE' }),
  history: (groupId: string, parameters: URLSearchParams, signal?: AbortSignal) =>
    requestJson<PollHistoryListResult>(`${groupPath(groupId)}/history?${parameters}`, { signal }),
  historyDetail: (groupId: string, messageId: string, signal?: AbortSignal) =>
    requestJson<PollHistoryDetail>(`${groupPath(groupId)}/history/${encodeURIComponent(messageId)}`, { signal }),
  stats: (groupId: string, signal?: AbortSignal) =>
    requestJson<PersistedStatsResult>(`${groupPath(groupId)}/stats`, { signal })
};
