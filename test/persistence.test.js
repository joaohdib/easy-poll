'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { createDatabase } = require('../src/db/database');
const { runMigrations } = require('../src/db/migrate');
const { PersistenceService } = require('../src/services/persistence.service');
const {
  createPersistablePoll,
  normalizeScannedPoll
} = require('../src/services/poll.service');

function createPersistence(databasePath = ':memory:') {
  const connection = createDatabase(databasePath);
  runMigrations(connection.db);
  return { connection, service: new PersistenceService(connection.db, () => 1_800_000_000) };
}

function poll(overrides = {}) {
  return {
    messageId: 'poll-1',
    question: 'Escolha',
    timestamp: 1_700_000_000,
    creatorId: 'creator@c.us',
    creatorName: 'Criador',
    options: [
      { text: 'A', position: 0, whatsappLocalId: '10' },
      { text: 'B', position: 1, whatsappLocalId: '11' },
      { text: 'C', position: 2, whatsappLocalId: '12' }
    ],
    allowMultipleAnswers: true,
    votes: [
      vote('voter-1@c.us', 'Votante 1', ['10'], ['A'], 1_700_000_100),
      vote('voter-2@c.us', 'Votante 2', ['11'], ['B'], 1_700_000_200),
      vote('voter-3@c.us', 'Votante 3', ['12'], ['C'], 1_700_000_300)
    ],
    votesAvailable: true,
    ...overrides
  };
}

function vote(voterId, voterName, selectedOptionIds, selectedOptions, timestamp) {
  return { voterId, voterName, selectedOptionIds, selectedOptions, timestamp };
}

function scan(polls = [poll()], processedMessages = []) {
  return {
    group: { id: 'group@g.us', name: 'Grupo' },
    polls,
    processedMessages
  };
}

function counts(sqlite) {
  return Object.fromEntries([
    'groups', 'members', 'polls', 'poll_options', 'poll_votes',
    'processed_messages', 'sync_state'
  ].map((table) => [
    table,
    sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count
  ]));
}

test('persists a normalized group, creator, poll, options, voters and votes', () => {
  const { connection, service } = createPersistence();
  try {
    service.persistScan(scan());
    assert.deepEqual(counts(connection.sqlite), {
      groups: 1, members: 4, polls: 1, poll_options: 3,
      poll_votes: 3, processed_messages: 0, sync_state: 1
    });
    const saved = service.polls.findByMessageId('poll-1');
    assert.equal(saved.poll.creatorId, 'creator@c.us');
    assert.deepEqual(saved.options.map((option) => option.whatsappLocalId), ['10', '11', '12']);
  } finally {
    connection.closeDatabase();
  }
});

test('persisting the same scan twice is idempotent', () => {
  const { connection, service } = createPersistence();
  try {
    service.persistScan(scan());
    service.persistScan(scan());
    assert.deepEqual(counts(connection.sqlite), {
      groups: 1, members: 4, polls: 1, poll_options: 3,
      poll_votes: 3, processed_messages: 0, sync_state: 1
    });
  } finally {
    connection.closeDatabase();
  }
});

test('a poll remains readable after closing and reopening a file database', () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'easypoll-restart-'));
  const databasePath = path.join(temporaryRoot, 'restart.db');
  let first;
  let second;
  try {
    first = createPersistence(databasePath);
    first.service.persistScan(scan());
    first.connection.closeDatabase();
    assert.equal(existsSync(databasePath), true);

    second = createPersistence(databasePath);
    const saved = second.service.polls.findByMessageId('poll-1');
    assert.equal(saved.poll.question, 'Escolha');
    assert.equal(saved.options.length, 3);
    assert.equal(saved.votes.length, 3);
  } finally {
    first?.connection.closeDatabase();
    second?.connection.closeDatabase();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('persists multiple selected options for the same voter', () => {
  const { connection, service } = createPersistence();
  try {
    service.persistScan(scan([poll({
      votes: [vote('voter-1@c.us', 'Votante 1', ['10', '11'], ['A', 'B'], 100)]
    })]));
    assert.equal(service.polls.findByMessageId('poll-1').votes.length, 2);
  } finally {
    connection.closeDatabase();
  }
});

test('a successful later snapshot replaces a changed vote', () => {
  const { connection, service } = createPersistence();
  try {
    service.persistScan(scan([poll({
      votes: [vote('voter-1@c.us', 'Votante 1', ['10'], ['A'], 100)]
    })]));
    service.persistScan(scan([poll({
      votes: [vote('voter-1@c.us', 'Votante 1', ['11'], ['B'], 200)]
    })]));
    const saved = service.polls.findByMessageId('poll-1');
    assert.deepEqual(saved.votes.map(({ optionId }) => optionId), [saved.options[1].id]);
  } finally {
    connection.closeDatabase();
  }
});

test('a successful later snapshot removes only deselected choices', () => {
  const { connection, service } = createPersistence();
  try {
    service.persistScan(scan([poll({
      votes: [vote('voter-1@c.us', 'Votante 1', ['10', '11'], ['A', 'B'], 100)]
    })]));
    service.persistScan(scan([poll({
      votes: [vote('voter-1@c.us', 'Votante 1', ['11'], ['B'], 200)]
    })]));
    assert.equal(service.polls.findByMessageId('poll-1').votes.length, 1);
  } finally {
    connection.closeDatabase();
  }
});

test('a successful empty snapshot clears old votes', () => {
  const { connection, service } = createPersistence();
  try {
    service.persistScan(scan());
    service.persistScan(scan([poll({ votes: [], votesAvailable: true })]));
    assert.equal(service.polls.findByMessageId('poll-1').votes.length, 0);
  } finally {
    connection.closeDatabase();
  }
});

test('an unavailable vote snapshot preserves the last valid snapshot', () => {
  const { connection, service } = createPersistence();
  try {
    service.persistScan(scan());
    service.persistScan(scan([poll({ votes: [], votesAvailable: false })]));
    assert.equal(service.polls.findByMessageId('poll-1').votes.length, 3);
  } finally {
    connection.closeDatabase();
  }
});

test('local IDs distinguish duplicate option text and ambiguity is never guessed', () => {
  const { connection, service } = createPersistence();
  try {
    const duplicateOptions = [
      { text: 'Sim', position: 0, whatsappLocalId: '20' },
      { text: 'Sim', position: 1, whatsappLocalId: '21' },
      { text: 'Não', position: 2, whatsappLocalId: '22' }
    ];
    service.persistScan(scan([poll({
      options: duplicateOptions,
      votes: [vote('voter-1@c.us', 'Votante 1', ['21'], ['Sim'], 100)]
    })]));
    let saved = service.polls.findByMessageId('poll-1');
    assert.equal(saved.votes[0].optionId, saved.options[1].id);

    service.persistScan(scan([poll({
      options: duplicateOptions.map((option) => ({ ...option, whatsappLocalId: null })),
      votes: [vote('voter-1@c.us', 'Votante 1', [], ['Sim'], 200)]
    })]));
    saved = service.polls.findByMessageId('poll-1');
    assert.equal(saved.votes.length, 1);
    assert.equal(saved.votes[0].optionId, saved.options[1].id);
  } finally {
    connection.closeDatabase();
  }
});

test('missing creator metadata does not erase a previously known creator', () => {
  const { connection, service } = createPersistence();
  try {
    service.persistScan(scan());
    service.persistScan(scan([poll({ creatorId: null, creatorName: null })]));
    assert.equal(service.polls.findByMessageId('poll-1').poll.creatorId, 'creator@c.us');
  } finally {
    connection.closeDatabase();
  }
});

test('group and member UPSERTs refresh valid names without degrading them to missing names', () => {
  const { connection, service } = createPersistence();
  try {
    service.persistScan(scan([poll({
      votes: [vote('voter-1@c.us', 'Nome antigo', ['10'], ['A'], 100)]
    })]));
    service.persistScan({
      ...scan([poll({
        creatorName: null,
        votes: [vote('voter-1@c.us', 'Nome novo', ['10'], ['A'], 200)]
      })]),
      group: { id: 'group@g.us', name: 'Grupo renomeado' }
    });
    service.persistScan(scan([poll({
      creatorName: null,
      votes: [vote('voter-1@c.us', null, ['10'], ['A'], 300)]
    })]));
    assert.equal(service.groups.findById('group@g.us').name, 'Grupo');
    assert.equal(service.members.findById('voter-1@c.us').displayName, 'Nome novo');
    assert.equal(service.members.findById('creator@c.us').displayName, 'Criador');
  } finally {
    connection.closeDatabase();
  }
});

test('option reconciliation preserves matching row IDs and removes proven stale options', () => {
  const { connection, service } = createPersistence();
  try {
    service.persistScan(scan());
    const before = service.polls.findByMessageId('poll-1').options;
    service.persistScan(scan([poll({
      options: [
        { text: 'B atualizada', position: 0, whatsappLocalId: '11' },
        { text: 'C', position: 1, whatsappLocalId: '12' }
      ],
      votes: [vote('voter-2@c.us', 'Votante 2', ['11'], ['B atualizada'], 200)]
    })]));
    const after = service.polls.findByMessageId('poll-1').options;
    assert.deepEqual(after.map(({ whatsappLocalId }) => whatsappLocalId), ['11', '12']);
    assert.equal(after[0].id, before[1].id);
    assert.equal(after[1].id, before[2].id);
  } finally {
    connection.closeDatabase();
  }
});

test('processed messages deduplicate and sync_state counts unique known rows', () => {
  const { connection, service } = createPersistence();
  try {
    const first = Array.from({ length: 100 }, (_, index) => ({
      id: `message-${index}`, groupId: 'group@g.us', type: 'chat', timestamp: 100 + index
    }));
    service.persistScan(scan([], first));
    service.persistScan(scan([], first));
    assert.equal(service.scanState.countByGroup('group@g.us'), 100);

    const overlapAndNew = Array.from({ length: 100 }, (_, index) => ({
      id: `message-${index + 20}`, groupId: 'group@g.us', type: 'chat', timestamp: 120 + index
    }));
    service.persistScan(scan([], overlapAndNew));
    const state = service.scanState.findSyncState('group@g.us');
    assert.equal(state.messagesProcessed, 120);
    assert.equal(state.oldestProcessedTimestamp, 100);
    assert.equal(state.newestProcessedTimestamp, 219);
    assert.equal(state.lastSyncAt, 1_800_000_000);
  } finally {
    connection.closeDatabase();
  }
});

test('processed message insertion crosses multiple configured batches safely', () => {
  const { connection, service } = createPersistence();
  try {
    const messages = Array.from({ length: 600 }, (_, index) => ({
      id: `batch-message-${index}`,
      groupId: 'group@g.us',
      type: 'chat',
      timestamp: 1_000 + index
    }));
    service.persistScan(scan([], messages));
    assert.equal(service.scanState.countByGroup('group@g.us'), 600);
  } finally {
    connection.closeDatabase();
  }
});

test('older partial scans lower oldest without lowering newest', () => {
  const { connection, service } = createPersistence();
  try {
    service.persistScan(scan([], [100, 200, 300].map((timestamp) => ({
      id: `message-${timestamp}`, groupId: 'group@g.us', type: 'chat', timestamp
    }))));
    service.persistScan(scan([], [50, 150].map((timestamp) => ({
      id: `message-${timestamp}`, groupId: 'group@g.us', type: 'chat', timestamp
    }))));
    const state = service.scanState.findSyncState('group@g.us');
    assert.equal(state.oldestProcessedTimestamp, 50);
    assert.equal(state.newestProcessedTimestamp, 300);
  } finally {
    connection.closeDatabase();
  }
});

test('timestamps from WhatsApp milliseconds are normalized to Unix seconds', () => {
  const normalized = normalizeScannedPoll({
    id: 'poll-ms', pollName: 'Tempo', timestamp: 1_700_000_000,
    pollOptions: [{ name: 'A', localId: 0 }]
  }, new Map(), null, [{
    voterId: 'voter@c.us', selectedOptionIds: [0], selectedOptions: ['A'],
    timestamp: 1_700_000_123_999
  }], null);
  const persistable = createPersistablePoll(normalized, [{ name: 'A', localId: 0 }]);
  assert.equal(persistable.timestamp, 1_700_000_000);
  assert.equal(persistable.votes[0].timestamp, 1_700_000_123);
});

test('an unexpected failure rolls back the whole logical scan transaction', () => {
  const { connection, service } = createPersistence();
  try {
    service.scanState.updateAfterScan = () => {
      throw new Error('forced failure');
    };
    assert.throws(() => service.persistScan(scan()), /forced failure/);
    assert.deepEqual(counts(connection.sqlite), {
      groups: 0, members: 0, polls: 0, poll_options: 0,
      poll_votes: 0, processed_messages: 0, sync_state: 0
    });
  } finally {
    connection.closeDatabase();
  }
});
