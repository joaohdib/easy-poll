'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const {
  HistoryService,
  createProcessedMessageMetadata
} = require('../src/services/history.service');
const { createPollsRouter } = require('../src/routes/polls.routes');

function fakeWhatsApp(messages, events = []) {
  return {
    onConnectionLost() {},
    ensureConnected() {},
    async fetchGroupMessages() {
      events.push('messages-fetched');
      return { group: { id: 'group@g.us', name: 'Grupo' }, messages };
    },
    async hydratePollMessageIds() {},
    async getGroupMembers() {
      return {
        members: [
          { id: 'creator@c.us', name: 'Criador' },
          { id: 'voter@c.us', name: 'Votante' }
        ]
      };
    },
    getOwnIdentity() {
      return { id: null, name: null };
    },
    async getPollVotesForScan() {
      events.push('votes-normalized');
      return [{
        voterId: 'voter@c.us',
        selectedOptionIds: [1],
        selectedOptions: ['Sim'],
        timestamp: 1_700_000_100_000
      }];
    }
  };
}

test('the scanner persists normalized data after recovery and returns its existing contract', async () => {
  const events = [];
  let persistenceInput;
  const messages = [
    {
      id: 'ordinary-message', type: 'chat', timestamp: 1_700_000_000,
      body: 'conteúdo privado que não pode ser persistido', caption: 'segredo'
    },
    {
      id: 'poll-message', type: 'poll_creation', timestamp: 1_700_000_010,
      pollName: 'Pergunta', author: 'creator@c.us',
      pollOptions: [{ name: 'Não', localId: 0 }, { name: 'Sim', localId: 1 }],
      allowMultipleAnswers: false
    }
  ];
  const persistence = {
    persistScan(input) {
      events.push('persisted');
      persistenceInput = input;
    }
  };
  const history = new HistoryService(fakeWhatsApp(messages, events), persistence);

  const result = await history.scanGroupPolls('group@g.us', 100);

  assert.deepEqual(events, ['messages-fetched', 'votes-normalized', 'persisted']);
  assert.deepEqual(Object.keys(result).sort(), [
    'group', 'messageTypes', 'messagesScanned', 'polls', 'pollsFound',
    'pollsWithVotesAvailable', 'requestedLimit'
  ]);
  assert.deepEqual(result.polls[0].options, ['Não', 'Sim']);
  assert.equal(Object.hasOwn(result.polls[0], 'whatsappLocalId'), false);
  assert.deepEqual(
    persistenceInput.polls[0].options.map(({ whatsappLocalId }) => whatsappLocalId),
    ['0', '1']
  );
  assert.deepEqual(persistenceInput.processedMessages, [
    { id: 'ordinary-message', groupId: 'group@g.us', type: 'chat', timestamp: 1_700_000_000 },
    { id: 'poll-message', groupId: 'group@g.us', type: 'poll_creation', timestamp: 1_700_000_010 }
  ]);
});

test('processed message DTOs contain metadata only and normalize milliseconds', () => {
  const metadata = createProcessedMessageMetadata({
    id: 'message-1', type: 'chat', timestamp: 1_700_000_123_999,
    body: 'privado', text: 'privado', media: Buffer.from('privado')
  }, 'group@g.us');
  assert.deepEqual(metadata, {
    id: 'message-1', groupId: 'group@g.us', type: 'chat', timestamp: 1_700_000_123
  });
  assert.deepEqual(Object.keys(metadata).sort(), ['groupId', 'id', 'timestamp', 'type']);
});

test('a persistence failure makes the scan fail instead of claiming success', async () => {
  const history = new HistoryService(fakeWhatsApp([]), {
    persistScan() {
      throw new Error('disk full');
    }
  });
  await assert.rejects(
    history.scanGroupPolls('group@g.us', 100),
    (error) => error.code === 'PERSISTENCE_FAILED' && /banco local/.test(error.message)
  );
});

test('the scan endpoint still returns the exact in-memory scan response', async () => {
  const expected = {
    group: { id: 'group@g.us', name: 'Grupo' },
    requestedLimit: 25,
    messagesScanned: 1,
    pollsFound: 0,
    pollsWithVotesAvailable: 0,
    messageTypes: { chat: 1 },
    polls: []
  };
  const history = {
    async scanGroupPolls(groupId, limit) {
      assert.equal(groupId, 'group@g.us');
      assert.equal(limit, 25);
      return expected;
    }
  };
  const analysisState = { latestPollScan: null };
  const app = express();
  app.use(express.json());
  app.use('/api', createPollsRouter({}, history, analysisState));
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });

  try {
    const address = server.address();
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/groups/group%40g.us/polls/scan`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ limit: 25 })
      }
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), expected);
    assert.deepEqual(analysisState.latestPollScan, {
      group: expected.group, pollsFound: 0, polls: []
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
