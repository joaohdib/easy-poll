'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { createDatabase } = require('../src/db/database');
const { runMigrations } = require('../src/db/migrate');
const {
  HistoryRepository,
  HISTORY_DETAIL_QUERY_COUNT,
  HISTORY_LIST_QUERY_COUNT
} = require('../src/repositories/history.repository');
const { createHistoryRouter } = require('../src/routes/history.routes');
const { HistoryQueryService } = require('../src/services/history-query.service');
const { PersistenceService } = require('../src/services/persistence.service');

const GROUP = { id: 'history-group@g.us', name: 'Grupo Histórico' };
const OTHER_GROUP = { id: 'other-group@g.us', name: 'Outro grupo' };
const WHATSAPP_MODULE_PATH = require.resolve('whatsapp-web.js');

function createHarness(databasePath = ':memory:') {
  const connection = createDatabase(databasePath);
  runMigrations(connection.db);
  const persistence = new PersistenceService(connection.db, () => 1_800_000_000);
  const repository = new HistoryRepository(connection.db);
  return {
    connection,
    persistence,
    repository,
    query: new HistoryQueryService(repository)
  };
}

function option(text, position, whatsappLocalId = String(position)) {
  return { text, position, whatsappLocalId };
}

function vote(voterId, voterName, selectedOptionIds, selectedOptions, timestamp = null) {
  return { voterId, voterName, selectedOptionIds, selectedOptions, timestamp };
}

function poll(overrides = {}) {
  return {
    messageId: 'poll-1',
    question: 'Qual jogo?',
    timestamp: 1_700_000_000,
    creatorId: 'creator@c.us',
    creatorName: 'João',
    options: [option('A', 0), option('B', 1)],
    allowMultipleAnswers: true,
    votes: [],
    votesAvailable: true,
    ...overrides
  };
}

function persist(harness, polls, group = GROUP, processedMessages = []) {
  harness.persistence.persistScan({ group, polls, processedMessages });
}

test('lists local polls newest first with stable message ID ordering', () => {
  const harness = createHarness();
  try {
    persist(harness, [
      poll({ messageId: 'older', timestamp: 100, question: 'Antiga' }),
      poll({ messageId: 'tie-a', timestamp: 200, question: 'Empate A' }),
      poll({ messageId: 'tie-b', timestamp: 200, question: 'Empate B' })
    ]);
    const result = harness.query.listGroupHistory(GROUP.id, {});

    assert.equal(HISTORY_LIST_QUERY_COUNT, 2);
    assert.deepEqual(result.items.map(({ messageId }) => messageId), ['tie-b', 'tie-a', 'older']);
    assert.deepEqual(result.pagination, {
      page: 1, pageSize: 25, totalItems: 3, totalPages: 1
    });
  } finally {
    harness.connection.closeDatabase();
  }
});

test('paginates 60 polls in SQLite with 25, 25 and 10 rows', () => {
  const harness = createHarness();
  try {
    persist(harness, Array.from({ length: 60 }, (_, index) => poll({
      messageId: `page-${String(index).padStart(2, '0')}`,
      question: `Pergunta ${index}`,
      timestamp: 1_700_000_000 + index
    })));

    const first = harness.query.listGroupHistory(GROUP.id, { page: '1', pageSize: '25' });
    const second = harness.query.listGroupHistory(GROUP.id, { page: '2', pageSize: '25' });
    const third = harness.query.listGroupHistory(GROUP.id, { page: '3', pageSize: '25' });
    assert.deepEqual([first.items.length, second.items.length, third.items.length], [25, 25, 10]);
    assert.equal(first.pagination.totalItems, 60);
    assert.equal(first.pagination.totalPages, 3);
  } finally {
    harness.connection.closeDatabase();
  }
});

test('searches questions case-insensitively and treats LIKE wildcards literally', () => {
  const harness = createHarness();
  try {
    persist(harness, [
      poll({ messageId: 'game-1', question: 'Qual jogo?' }),
      poll({ messageId: 'food', question: 'Onde vamos comer?' }),
      poll({ messageId: 'game-2', question: 'Qual JOGO amanhã?' }),
      poll({ messageId: 'percent', question: 'Resultado 100% certo' })
    ]);
    assert.deepEqual(
      harness.query.listGroupHistory(GROUP.id, { search: 'jogo' }).items
        .map(({ messageId }) => messageId).sort(),
      ['game-1', 'game-2']
    );
    assert.deepEqual(
      harness.query.listGroupHistory(GROUP.id, { search: '%' }).items
        .map(({ messageId }) => messageId),
      ['percent']
    );
  } finally {
    harness.connection.closeDatabase();
  }
});

test('filters one São Paulo calendar day with a half-open local interval', () => {
  const harness = createHarness();
  const dayStart = Date.parse('2026-08-21T03:00:00Z') / 1000;
  try {
    persist(harness, [
      poll({ messageId: 'before', timestamp: dayStart - 1 }),
      poll({ messageId: 'start', timestamp: dayStart }),
      poll({ messageId: 'end', timestamp: dayStart + 86_399 }),
      poll({ messageId: 'after', timestamp: dayStart + 86_400 })
    ]);
    const result = harness.query.listGroupHistory(GROUP.id, {
      from: '2026-08-21',
      to: '2026-08-21'
    });
    assert.deepEqual(result.items.map(({ messageId }) => messageId), ['end', 'start']);
  } finally {
    harness.connection.closeDatabase();
  }
});

test('distinguishes participants, selections, unavailable snapshot and valid empty snapshot', () => {
  const harness = createHarness();
  try {
    persist(harness, [
      poll({
        messageId: 'multiple',
        votes: [
          vote('joao@c.us', 'João', ['0', '1'], ['A', 'B']),
          vote('maria@c.us', 'Maria', ['1'], ['B'])
        ]
      }),
      poll({ messageId: 'unavailable', votesAvailable: false }),
      poll({ messageId: 'empty', votes: [], votesAvailable: true })
    ]);
    const byId = Object.fromEntries(
      harness.query.listGroupHistory(GROUP.id, {}).items.map((item) => [item.messageId, item])
    );

    assert.equal(byId.multiple.participantCount, 2);
    assert.equal(byId.multiple.selectionCount, 3);
    assert.equal(byId.unavailable.participantCount, null);
    assert.equal(byId.unavailable.selectionCount, null);
    assert.equal(byId.empty.participantCount, 0);
    assert.equal(byId.empty.selectionCount, 0);
    assert.equal(harness.query.getPollDetail(GROUP.id, 'unavailable').participants, null);
    assert.deepEqual(harness.query.getPollDetail(GROUP.id, 'empty').participants, []);
  } finally {
    harness.connection.closeDatabase();
  }
});

test('loads detail on demand with creator, ordered options and FK-based duplicate choices', () => {
  const harness = createHarness();
  try {
    persist(harness, [poll({
      messageId: 'duplicate-options',
      question: 'Confirma?',
      options: [option('Sim', 0, '20'), option('Sim', 1, '21')],
      votes: [vote('joao@c.us', 'João', ['21'], ['Sim'], 1_700_000_100)]
    })]);
    const detail = harness.query.getPollDetail(GROUP.id, 'duplicate-options');

    assert.equal(HISTORY_DETAIL_QUERY_COUNT, 3);
    assert.equal(detail.creator.displayName, 'João');
    assert.deepEqual(detail.options.map(({ position, selectionCount }) => (
      { position, selectionCount }
    )), [
      { position: 0, selectionCount: 0 },
      { position: 1, selectionCount: 1 }
    ]);
    assert.deepEqual(detail.participants[0].selectedOptions.map(({ position }) => position), [1]);
    assert.equal(detail.participantCount, 1);
    assert.equal(detail.selectionCount, 1);
  } finally {
    harness.connection.closeDatabase();
  }
});

test('returns null creator and never exposes a poll through a different group', () => {
  const harness = createHarness();
  try {
    persist(harness, [poll({
      messageId: 'anonymous', creatorId: null, creatorName: null
    })]);
    persist(harness, [], OTHER_GROUP);
    assert.equal(harness.query.getPollDetail(GROUP.id, 'anonymous').creator, null);
    assert.equal(harness.query.getPollDetail(OTHER_GROUP.id, 'anonymous'), null);
  } finally {
    harness.connection.closeDatabase();
  }
});

test('history listing and detail survive closing and reopening SQLite', () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'easypoll-history-restart-'));
  const databasePath = path.join(temporaryRoot, 'history.db');
  let first;
  let second;
  try {
    first = createHarness(databasePath);
    persist(first, [poll()]);
    first.connection.closeDatabase();

    second = createHarness(databasePath);
    assert.equal(second.query.listGroupHistory(GROUP.id, {}).items[0].question, 'Qual jogo?');
    assert.equal(second.query.getPollDetail(GROUP.id, 'poll-1').options.length, 2);
  } finally {
    first?.connection.closeDatabase();
    second?.connection.closeDatabase();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('local history APIs work without loading WhatsApp and validate unsafe parameters', async () => {
  const harness = createHarness();
  let server;
  try {
    persist(harness, [poll({ messageId: 'poll/special?value' })]);
    const app = express();
    app.use('/api', createHistoryRouter(harness.query));
    server = await new Promise((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const base = `http://127.0.0.1:${server.address().port}/api/groups`;
    const groupPath = encodeURIComponent(GROUP.id);
    const listResponse = await fetch(`${base}/${groupPath}/history`);
    const detailResponse = await fetch(
      `${base}/${groupPath}/history/${encodeURIComponent('poll/special?value')}`
    );
    const invalidRequests = await Promise.all([
      fetch(`${base}/${groupPath}/history?page=0`),
      fetch(`${base}/${groupPath}/history?pageSize=-1`),
      fetch(`${base}/${groupPath}/history?pageSize=100000`),
      fetch(`${base}/${groupPath}/history?from=2026-02-30`)
    ]);
    const missingGroup = await fetch(`${base}/missing%40g.us/history`);
    const wrongGroup = await fetch(
      `${base}/${encodeURIComponent(OTHER_GROUP.id)}/history/${encodeURIComponent('poll/special?value')}`
    );

    assert.equal(listResponse.status, 200);
    assert.equal(detailResponse.status, 200);
    assert.deepEqual(invalidRequests.map(({ status }) => status), [400, 400, 400, 400]);
    assert.equal(missingGroup.status, 404);
    assert.equal(wrongGroup.status, 404);
    assert.equal(require.cache[WHATSAPP_MODULE_PATH], undefined);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    harness.connection.closeDatabase();
  }
});

test('lists the first page of 1,000 polls and 20,000 selections in bounded time', () => {
  const harness = createHarness();
  try {
    const sqlite = harness.connection.sqlite;
    const seed = sqlite.transaction(() => {
      sqlite.prepare('INSERT INTO groups (id, name) VALUES (?, ?)').run(GROUP.id, GROUP.name);
      const insertMember = sqlite.prepare('INSERT INTO members (id, display_name) VALUES (?, ?)');
      for (let voterIndex = 0; voterIndex < 20; voterIndex += 1) {
        insertMember.run(`scale-voter-${voterIndex}@c.us`, `Pessoa ${voterIndex}`);
      }
      const insertPoll = sqlite.prepare(`
        INSERT INTO polls (
          message_id, group_id, question, created_at, allow_multiple_answers,
          votes_snapshot_available, votes_snapshot_at
        ) VALUES (?, ?, ?, ?, 0, 1, ?)
      `);
      const insertOption = sqlite.prepare(
        'INSERT INTO poll_options (poll_id, text, position, whatsapp_local_id) VALUES (?, ?, ?, ?)'
      );
      const insertVote = sqlite.prepare(
        'INSERT INTO poll_votes (poll_id, voter_id, option_id, voted_at) VALUES (?, ?, ?, ?)'
      );
      for (let pollIndex = 0; pollIndex < 1_000; pollIndex += 1) {
        const pollId = `scale-poll-${pollIndex}`;
        const timestamp = 1_700_000_000 + pollIndex;
        insertPoll.run(pollId, GROUP.id, `Pergunta ${pollIndex}`, timestamp, timestamp);
        const optionId = Number(insertOption.run(pollId, 'A', 0, '0').lastInsertRowid);
        for (let voterIndex = 0; voterIndex < 20; voterIndex += 1) {
          insertVote.run(
            pollId,
            `scale-voter-${voterIndex}@c.us`,
            optionId,
            timestamp + voterIndex
          );
        }
      }
    });
    seed();

    const startedAt = performance.now();
    const result = harness.query.listGroupHistory(GROUP.id, {});
    const elapsedMs = performance.now() - startedAt;
    assert.equal(result.items.length, 25);
    assert.equal(result.pagination.totalItems, 1_000);
    assert.equal(result.items[0].participantCount, 20);
    assert.equal(result.items[0].selectionCount, 20);
    assert.ok(elapsedMs < 5_000, `history listing took ${elapsedMs.toFixed(1)}ms`);
  } finally {
    harness.connection.closeDatabase();
  }
});
