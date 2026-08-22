'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { WhatsAppService } = require('../src/services/whatsapp.service');

function serviceState(status, client) {
  const service = Object.create(WhatsAppService.prototype);
  Object.assign(service, {
    client,
    status,
    qrDataUrl: null,
    lastError: null,
    initialized: true,
    initializationRetryCount: 0,
    readyClient: status === 'connected' ? client : null
  });
  return service;
}

test('a late initialize rejection cannot overwrite a client that emitted ready', async () => {
  const client = {};
  const service = serviceState('connected', client);
  // A later library callback may temporarily change the public status even
  // though this exact client has already emitted ready.
  service.status = 'connecting';
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...values) => warnings.push(values.map(String).join(' '));
  try {
    await service.handleInitializationError(client, new Error('Timed out after waiting 30000ms'));
  } finally {
    console.warn = originalWarn;
  }

  assert.deepEqual(service.getStatus(), {
    status: 'connected',
    connected: true,
    hasQrCode: false,
    error: null
  });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /mantendo a conexão/i);
});

test('an initialize rejection before ready still reports disconnected', async () => {
  const client = {};
  const service = serviceState('connecting', client);
  const originalError = console.error;
  console.error = () => {};
  try {
    await service.handleInitializationError(client, new Error('browser could not start'));
  } finally {
    console.error = originalError;
  }

  assert.deepEqual(service.getStatus(), {
    status: 'disconnected',
    connected: false,
    hasQrCode: false,
    error: 'Não foi possível iniciar o WhatsApp Web.'
  });
});
