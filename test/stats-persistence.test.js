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
  StatsRepository,
  STATS_DATASET_QUERY_COUNT
} = require('../src/repositories/stats.repository');
const { createStatsRouter } = require('../src/routes/stats.routes');
const { PersistenceService } = require('../src/services/persistence.service');
const { StatsQueryService } = require('../src/services/stats-query.service');
const { calculatePollStats } = require('../src/services/stats.service');

const GROUP = { id: 'stats-group@g.us', name: 'Grupo Stats' };
const WHATSAPP_MODULE_PATH = require.resolve('whatsapp-web.js');

function createHarness(databasePath = ':memory:', now = 1_800_000_000) {
  const connection = createDatabase(databasePath);
  runMigrations(connection.db);
  const persistence = new PersistenceService(connection.db, () => now);
  const repository = new StatsRepository(connection.db);
  return {
    connection,
    persistence,
    repository,
    query: new StatsQueryService(repository)
  };
}

function option(text, position, whatsappLocalId = String(position)) {
  return { text, position, whatsappLocalId };
}

function vote(voterId, voterName, selectedOptionIds, selectedOptions, timestamp) {
  return { voterId, voterName, selectedOptionIds, selectedOptions, timestamp };
}

function storedPoll(overrides = {}) {
  return {
    messageId: 'poll-1',
    question: 'Escolha',
    timestamp: 1_700_000_000,
    creatorId: 'creator@c.us',
    creatorName: 'Criador',
    options: [option('A', 0), option('B', 1), option('C', 2)],
    allowMultipleAnswers: true,
    votes: [
      vote('voter-1@c.us', 'Ana', ['0', '1'], ['A', 'B'], 1_700_000_100),
      vote('voter-2@c.us', 'Bruno', ['1'], ['B'], 1_700_000_200)
    ],
    votesAvailable: true,
    ...overrides
  };
}

function analysisPoll(poll) {
  const participants = poll.votesAvailable ? poll.votes.map((item) => ({
    userId: item.voterId,
    name: item.voterName,
    selectedOptions: [...item.selectedOptions],
    voteTimestamp: item.timestamp
  })) : [];
  return {
    id: poll.messageId,
    question: poll.question,
    timestamp: poll.timestamp,
    options: poll.options.map(({ text }) => text),
    votesAvailable: poll.votesAvailable,
    participants,
    votes: participants.map((participant) => ({
      voterId: participant.userId,
      voterName: participant.name,
      selectedOptions: [...participant.selectedOptions],
      timestamp: participant.voteTimestamp
    })),
    creatorId: poll.creatorId,
    creatorName: poll.creatorName
  };
}

function persist(persistence, polls, group = GROUP, processedMessages = []) {
  return persistence.persistScan({ group, polls, processedMessages });
}

test('SQLite reconstruction produces the same deterministic StatsResult as memory', () => {
  const harness = createHarness();
  const polls = [
    storedPoll(),
    storedPoll({
      messageId: 'poll-2',
      question: 'Sem votos',
      timestamp: 1_700_086_400,
      creatorId: 'creator-2@c.us',
      creatorName: 'Outra criadora',
      votes: [],
      votesAvailable: true
    }),
    storedPoll({
      messageId: 'poll-3',
      question: 'Snapshot indisponível',
      timestamp: 1_700_172_800,
      votes: [],
      votesAvailable: false
    })
  ];
  try {
    persist(harness.persistence, polls);
    const memoryResult = calculatePollStats({
      group: GROUP,
      pollsFound: polls.length,
      polls: polls.map(analysisPoll)
    });
    const persistedResult = harness.query.getGroupStats(GROUP.id);

    assert.deepEqual(persistedResult.stats, memoryResult);
    assert.equal(persistedResult.stats.summary.pollsFound, 3);
    assert.equal(persistedResult.stats.summary.eligiblePolls, 2);
    assert.equal(persistedResult.stats.summary.totalParticipations, 2);
    assert.equal(persistedResult.stats.summary.pollsWithIdentifiedCreator, 3);
  } finally {
    harness.connection.closeDatabase();
  }
});

test('persisted Stats survive closing and reopening SQLite', () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'easypoll-stats-restart-'));
  const databasePath = path.join(temporaryRoot, 'stats.db');
  let first;
  let second;
  try {
    first = createHarness(databasePath);
    persist(first.persistence, [storedPoll()], GROUP, [
      { id: 'poll-1', groupId: GROUP.id, type: 'poll_creation', timestamp: 1_700_000_000 }
    ]);
    const expected = first.query.getGroupStats(GROUP.id);
    first.connection.closeDatabase();

    second = createHarness(databasePath);
    assert.deepEqual(second.query.getGroupStats(GROUP.id), expected);
  } finally {
    first?.connection.closeDatabase();
    second?.connection.closeDatabase();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('valid empty and unavailable vote snapshots remain distinguishable', () => {
  const harness = createHarness();
  try {
    persist(harness.persistence, [
      storedPoll({ messageId: 'empty', votes: [], votesAvailable: true }),
      storedPoll({ messageId: 'unavailable', votes: [], votesAvailable: false })
    ]);
    const dataset = harness.repository.loadGroupDataset(GROUP.id).analysis;
    const empty = dataset.polls.find(({ id }) => id === 'empty');
    const unavailable = dataset.polls.find(({ id }) => id === 'unavailable');
    const rows = harness.connection.sqlite.prepare(`
      SELECT message_id AS messageId,
             votes_snapshot_available AS available,
             votes_snapshot_at AS snapshotAt
      FROM polls ORDER BY message_id
    `).all();

    assert.deepEqual(empty.participants, []);
    assert.equal(empty.votesAvailable, true);
    assert.equal(unavailable.votesAvailable, false);
    assert.deepEqual(rows, [
      { messageId: 'empty', available: 1, snapshotAt: 1_800_000_000 },
      { messageId: 'unavailable', available: 0, snapshotAt: null }
    ]);
  } finally {
    harness.connection.closeDatabase();
  }
});

test('a failed later recovery keeps the last valid vote snapshot and timestamp', () => {
  const harness = createHarness(':memory:', 1_800_000_000);
  try {
    persist(harness.persistence, [storedPoll()]);
    persist(harness.persistence, [storedPoll({ votes: [], votesAvailable: false })]);
    const result = harness.query.getGroupStats(GROUP.id);
    const saved = harness.connection.sqlite.prepare(`
      SELECT votes_snapshot_available AS available, votes_snapshot_at AS snapshotAt
      FROM polls WHERE message_id = 'poll-1'
    `).get();

    assert.deepEqual(saved, { available: 1, snapshotAt: 1_800_000_000 });
    assert.equal(result.stats.summary.totalParticipations, 2);
  } finally {
    harness.connection.closeDatabase();
  }
});

test('multiple choices reconstruct one participant with two selected options', () => {
  const harness = createHarness();
  try {
    persist(harness.persistence, [storedPoll({
      votes: [vote('voter-1@c.us', 'Ana', ['0', '1'], ['A', 'B'], 1_700_000_100)]
    })]);
    const poll = harness.repository.loadGroupDataset(GROUP.id).analysis.polls[0];
    assert.equal(poll.participants.length, 1);
    assert.deepEqual(poll.participants[0].selectedOptions, ['A', 'B']);
    assert.equal(harness.query.getGroupStats(GROUP.id).stats.summary.totalParticipations, 1);
  } finally {
    harness.connection.closeDatabase();
  }
});

test('duplicate option text is joined through the persisted option_id', () => {
  const harness = createHarness();
  try {
    persist(harness.persistence, [storedPoll({
      options: [option('Sim', 0, '20'), option('Sim', 1, '21')],
      votes: [vote('voter-1@c.us', 'Ana', ['21'], ['Sim'], 1_700_000_100)]
    })]);
    const joined = harness.connection.sqlite.prepare(`
      SELECT poll_options.position, poll_options.whatsapp_local_id AS whatsappLocalId
      FROM poll_votes
      INNER JOIN poll_options ON poll_options.id = poll_votes.option_id
    `).get();
    const poll = harness.repository.loadGroupDataset(GROUP.id).analysis.polls[0];

    assert.deepEqual(joined, { position: 1, whatsappLocalId: '21' });
    assert.equal(harness.connection.sqlite.prepare(
      'SELECT COUNT(*) AS count FROM poll_options WHERE poll_id = ?'
    ).get('poll-1').count, 2);
    assert.deepEqual(poll.options, ['Sim']);
    assert.deepEqual(poll.participants[0].selectedOptions, ['Sim']);
  } finally {
    harness.connection.closeDatabase();
  }
});

test('local Stats and group APIs work without WhatsApp or History services', async () => {
  const harness = createHarness();
  const emptyGroup = { id: 'empty-group@g.us', name: 'Grupo vazio' };
  let server;
  try {
    persist(harness.persistence, [storedPoll()]);
    persist(harness.persistence, [], emptyGroup);
    const app = express();
    app.use('/api', createStatsRouter(
      { latestPollScan: null },
      harness.query
    ));
    server = await new Promise((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const base = `http://127.0.0.1:${server.address().port}/api`;

    const groupsResponse = await fetch(`${base}/local/groups`);
    const statsResponse = await fetch(`${base}/groups/${encodeURIComponent(GROUP.id)}/stats`);
    const emptyResponse = await fetch(`${base}/groups/${encodeURIComponent(emptyGroup.id)}/stats`);
    const missingResponse = await fetch(`${base}/groups/missing%40g.us/stats`);
    const legacyResponse = await fetch(`${base}/stats`);
    const localGroups = await groupsResponse.json();
    const stats = await statsResponse.json();
    const empty = await emptyResponse.json();

    assert.equal(groupsResponse.status, 200);
    assert.deepEqual(localGroups.groups.map(({ id, pollCount }) => ({ id, pollCount })), [
      { id: GROUP.id, pollCount: 1 },
      { id: emptyGroup.id, pollCount: 0 },
    ]);
    assert.equal(statsResponse.status, 200);
    assert.equal(stats.stats.summary.eligiblePolls, 1);
    assert.equal(stats.localData.groupId, GROUP.id);
    assert.equal(emptyResponse.status, 200);
    assert.equal(empty.stats.summary.pollsFound, 0);
    assert.equal(missingResponse.status, 404);
    assert.equal(legacyResponse.status, 404);
    assert.equal(require.cache[WHATSAPP_MODULE_PATH], undefined);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    harness.connection.closeDatabase();
  }
});

test('loads 300 polls and 6,000 vote rows with four fixed dataset queries', () => {
  const harness = createHarness();
  const polls = Array.from({ length: 300 }, (_, pollIndex) => storedPoll({
    messageId: `scale-poll-${pollIndex}`,
    question: `Pergunta ${pollIndex}`,
    timestamp: 1_700_000_000 + pollIndex,
    options: [option('A', 0), option('B', 1)],
    votes: Array.from({ length: 20 }, (_, voterIndex) => vote(
      `scale-voter-${voterIndex}@c.us`,
      `Pessoa ${voterIndex}`,
      [String(voterIndex % 2)],
      [voterIndex % 2 ? 'B' : 'A'],
      1_700_001_000 + pollIndex + voterIndex
    ))
  }));
  try {
    persist(harness.persistence, polls);
    const startedAt = performance.now();
    const result = harness.query.getGroupStats(GROUP.id);
    const elapsedMs = performance.now() - startedAt;

    assert.equal(STATS_DATASET_QUERY_COUNT, 4);
    assert.equal(result.stats.summary.pollsFound, 300);
    assert.equal(result.stats.summary.totalParticipations, 6_000);
    assert.ok(elapsedMs < 5_000, `local Stats took ${elapsedMs.toFixed(1)}ms`);
  } finally {
    harness.connection.closeDatabase();
  }
});
