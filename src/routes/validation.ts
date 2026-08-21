import type { SendPollInput } from '../domain/types';
import {
  HISTORY_PREPARE_DEFAULT_LIMIT,
  HISTORY_PREPARE_MAX_LIMIT,
  POLL_SCAN_DEFAULT_LIMIT,
  POLL_SCAN_MAX_LIMIT
} from '../services/history.service';

type ValidationResult<T> =
  | { value: T; error?: never }
  | { error: string; value?: never };

export interface PollScanPayload {
  groupId: string;
  limit: number;
}

export interface HistoryPreparePayload {
  groupId: string;
  target: number;
}

export function validatePoll(body: unknown): ValidationResult<SendPollInput> {
  if (!isRecord(body)) return { error: 'Corpo da solicitação inválido.' };

  const groupId = typeof body.groupId === 'string' ? body.groupId.trim() : '';
  const question = typeof body.question === 'string' ? body.question.trim() : '';
  const options = Array.isArray(body.options)
    ? body.options.map((option) => (typeof option === 'string' ? option.trim() : ''))
    : [];

  if (!groupId || !groupId.endsWith('@g.us')) return { error: 'Selecione um grupo válido.' };
  if (!question) return { error: 'Digite a pergunta da enquete.' };
  if (question.length > 255) return { error: 'A pergunta deve ter no máximo 255 caracteres.' };
  if (options.length < 2) return { error: 'Informe pelo menos duas opções.' };
  if (options.length > 12) return { error: 'Uma enquete pode ter no máximo 12 opções.' };
  if (options.some((option) => !option)) return { error: 'As opções não podem ficar vazias.' };
  if (options.some((option) => option.length > 100)) return { error: 'Cada opção deve ter no máximo 100 caracteres.' };
  if (new Set(options.map((option) => option.toLocaleLowerCase('pt-BR'))).size !== options.length) {
    return { error: 'As opções da enquete devem ser diferentes.' };
  }
  if (typeof body.allowMultipleAnswers !== 'boolean') {
    return { error: 'A configuração de múltiplas respostas é inválida.' };
  }

  return {
    value: { groupId, question, options, allowMultipleAnswers: body.allowMultipleAnswers }
  };
}

export function validatePollScan(
  groupIdValue: unknown,
  body: unknown
): ValidationResult<PollScanPayload> {
  const groupId = typeof groupIdValue === 'string' ? groupIdValue.trim() : '';
  if (!groupId.endsWith('@g.us')) return { error: 'Selecione um grupo válido.' };
  if (body !== undefined && !isRecord(body)) {
    return { error: 'Corpo da solicitação inválido.' };
  }

  const requestBody = isRecord(body) ? body : undefined;
  const rawLimit = requestBody?.limit ?? POLL_SCAN_DEFAULT_LIMIT;
  const limit = Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > POLL_SCAN_MAX_LIMIT) {
    return { error: `O limite deve ser um número inteiro entre 1 e ${POLL_SCAN_MAX_LIMIT}.` };
  }
  return { value: { groupId, limit } };
}

export function validateGroupId(groupIdValue: unknown): ValidationResult<string> {
  const groupId = typeof groupIdValue === 'string' ? groupIdValue.trim() : '';
  return groupId.endsWith('@g.us')
    ? { value: groupId }
    : { error: 'Selecione um grupo válido.' };
}

export function validateHistoryPrepare(
  groupIdValue: unknown,
  body: unknown
): ValidationResult<HistoryPreparePayload> {
  const group = validateGroupId(groupIdValue);
  if ('error' in group) return { error: group.error };
  if (body !== undefined && !isRecord(body)) {
    return { error: 'Corpo da solicitação inválido.' };
  }
  const requestBody = isRecord(body) ? body : undefined;
  const target = Number(requestBody?.target ?? HISTORY_PREPARE_DEFAULT_LIMIT);
  if (!Number.isInteger(target) || target < 1 || target > HISTORY_PREPARE_MAX_LIMIT) {
    return { error: `O alvo deve ser um número inteiro entre 1 e ${HISTORY_PREPARE_MAX_LIMIT}.` };
  }
  return { value: { groupId: group.value, target } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
