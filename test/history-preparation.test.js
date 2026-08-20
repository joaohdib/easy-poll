'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { WhatsAppService } = require('../src/whatsapp');

function makeService(counts) {
  const service = Object.create(WhatsAppService.prototype);
  service.historyPrepareTimeoutMs = 1000;
  service.historyPrepareDelayMs = 0;
  service.historyPrepareStableAttempts = 3;
  service.historyPreparationByGroup = new Map();
  service.activeHistoryPreparation = null;
  service.loadEarlierGroupMessages = async () => ({ loadedMessages: 50 });
  service.countAvailableGroupMessages = async () => counts.shift() ?? counts.at(-1) ?? 0;
  return service;
}

function makeJob(service, messagesAvailable, target) {
  const job = {
    token: Symbol('test-history-preparation'),
    groupId: '123@g.us',
    status: 'preparing',
    messagesAvailable,
    initialMessagesAvailable: messagesAvailable,
    attempts: 0,
    noGrowthAttempts: 0,
    target,
    strategy: 'test',
    detail: '',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    cancelRequested: false
  };
  service.activeHistoryPreparation = job;
  service.historyPreparationByGroup.set(job.groupId, job);
  return job;
}

test('preparation completes when the target becomes available', async () => {
  const service = makeService([50, 100]);
  const job = makeJob(service, 15, 100);

  await service.runGroupHistoryPreparation(job);

  assert.equal(job.status, 'completed');
  assert.equal(job.messagesAvailable, 100);
  assert.equal(job.attempts, 2);
  assert.equal(service.activeHistoryPreparation, null);
});

test('preparation stabilizes after three attempts without growth', async () => {
  const service = makeService([15, 15, 15]);
  const job = makeJob(service, 15, 500);

  await service.runGroupHistoryPreparation(job);

  assert.equal(job.status, 'stabilized');
  assert.equal(job.messagesAvailable, 15);
  assert.equal(job.noGrowthAttempts, 3);
  assert.match(job.detail, /3 tentativas/);
});

test('cancelling a job does not overwrite a replacement job', async () => {
  const service = makeService([]);
  const oldJob = makeJob(service, 15, 500);
  const newJob = { token: Symbol('replacement'), groupId: '456@g.us', status: 'preparing' };

  service.cancelActiveHistoryPreparation();
  service.activeHistoryPreparation = newJob;
  service.finishHistoryPreparation(oldJob, 'cancelled', 'late completion');

  assert.equal(oldJob.status, 'cancelled');
  assert.equal(service.activeHistoryPreparation, newJob);
});
