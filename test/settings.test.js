'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const express = require('express');
const { createDatabase } = require('../src/db/database');
const { runMigrations } = require('../src/db/migrate');
const { SettingsRepository } = require('../src/repositories/settings.repository');
const { createSettingsRouter } = require('../src/routes/settings.routes');
const { SettingsService } = require('../src/services/settings.service');
const { formatBytes } = require('../frontend/src/utils/format');

const DOMAIN_TABLES = [
  'groups', 'members', 'polls', 'poll_options', 'poll_votes',
  'processed_messages', 'sync_state'
];

function createSettings(databasePath = ':memory:') {
  const connection = createDatabase(databasePath);
  runMigrations(connection.db);
  const repository = new SettingsRepository(connection.sqlite);
  return {
    connection,
    repository,
    service: new SettingsService(repository, connection.databasePath)
  };
}

function seedSettings(sqlite) {
  const insertGroup = sqlite.prepare('INSERT INTO groups (id, name) VALUES (?, ?)');
  insertGroup.run('group-a@g.us', 'Grupo A');
  insertGroup.run('group-b@g.us', 'Grupo B');

  const insertMember = sqlite.prepare('INSERT INTO members (id, display_name) VALUES (?, ?)');
  insertMember.run('joao@c.us', 'João');
  insertMember.run('maria@c.us', 'Maria');
  insertMember.run('pedro@c.us', 'Pedro');

  const insertPoll = sqlite.prepare(`
    INSERT INTO polls (
      message_id, group_id, creator_id, question, created_at,
      allow_multiple_answers, votes_snapshot_available
    ) VALUES (?, ?, ?, ?, ?, 1, 1)
  `);
  const insertOption = sqlite.prepare(
    'INSERT INTO poll_options (poll_id, text, position) VALUES (?, ?, ?)'
  );
  const insertVote = sqlite.prepare(`
    INSERT INTO poll_votes (poll_id, voter_id, option_id, voted_at)
    VALUES (?, ?, ?, ?)
  `);

  const polls = [
    ['poll-a1', 'group-a@g.us', 'pedro@c.us'],
    ['poll-a2', 'group-a@g.us', 'joao@c.us'],
    ['poll-a3', 'group-a@g.us', null],
    ['poll-b1', 'group-b@g.us', 'joao@c.us'],
    ['poll-b2', 'group-b@g.us', null]
  ];
  const options = new Map();
  polls.forEach(([pollId, groupId, creatorId], index) => {
    insertPoll.run(pollId, groupId, creatorId, `Pergunta ${index + 1}`, 1_700_000_000 + index);
    const first = Number(insertOption.run(pollId, 'A', 0).lastInsertRowid);
    const second = Number(insertOption.run(pollId, 'B', 1).lastInsertRowid);
    options.set(pollId, [first, second]);
  });

  // João choosing A and B is one participation and two selections.
  insertVote.run('poll-a1', 'joao@c.us', options.get('poll-a1')[0], 1_700_000_100);
  insertVote.run('poll-a1', 'joao@c.us', options.get('poll-a1')[1], 1_700_000_100);
  insertVote.run('poll-a1', 'maria@c.us', options.get('poll-a1')[1], 1_700_000_110);
  insertVote.run('poll-a2', 'pedro@c.us', options.get('poll-a2')[0], 1_700_000_120);
  insertVote.run('poll-b1', 'joao@c.us', options.get('poll-b1')[0], 1_700_000_130);

  const insertProcessed = sqlite.prepare(`
    INSERT INTO processed_messages (message_id, group_id, message_type, message_timestamp)
    VALUES (?, ?, 'poll_creation', ?)
  `);
  insertProcessed.run('processed-a1', 'group-a@g.us', 1_700_000_000);
  insertProcessed.run('processed-a2', 'group-a@g.us', 1_700_000_001);
  insertProcessed.run('processed-b1', 'group-b@g.us', 1_700_000_002);

  const insertSync = sqlite.prepare(`
    INSERT INTO sync_state (
      group_id, last_sync_at, oldest_processed_timestamp,
      newest_processed_timestamp, messages_processed
    ) VALUES (?, ?, ?, ?, ?)
  `);
  insertSync.run('group-a@g.us', 1_700_001_000, 1_700_000_000, 1_700_000_100, 2);
  insertSync.run('group-b@g.us', 1_700_002_000, 1_700_000_002, 1_700_000_200, 1);
}

function tableCounts(sqlite) {
  return Object.fromEntries(DOMAIN_TABLES.map((table) => [
    table,
    sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count
  ]));
}

test('formats local storage sizes in pt-BR without another dependency', () => {
  assert.equal(formatBytes(932), '932 B');
  assert.equal(formatBytes(14.8 * 1024), '14,8 KB');
  assert.equal(formatBytes(15_518_924), '14,8 MB');
  assert.equal(formatBytes(1.2 * 1024 ** 3), '1,2 GB');
});

test('summarizes totals and per-group data without mixing multiple selections with participations', () => {
  const { connection, service } = createSettings();
  try {
    seedSettings(connection.sqlite);
    const summary = service.getStorageSummary();

    assert.deepEqual(summary.database, {
      fileName: 'easypoll.db', relativePath: 'data/easypoll.db', sizeBytes: 0
    });
    assert.deepEqual(summary.totals, {
      groups: 2, polls: 5, participations: 4, selections: 5, processedMessages: 3
    });
    assert.deepEqual(summary.groups, [
      {
        id: 'group-a@g.us', name: 'Grupo A', polls: 3,
        participations: 3, selections: 4, processedMessages: 2,
        lastSyncAt: 1_700_001_000,
        oldestProcessedTimestamp: 1_700_000_000,
        newestProcessedTimestamp: 1_700_000_100
      },
      {
        id: 'group-b@g.us', name: 'Grupo B', polls: 2,
        participations: 1, selections: 1, processedMessages: 1,
        lastSyncAt: 1_700_002_000,
        oldestProcessedTimestamp: 1_700_000_002,
        newestProcessedTimestamp: 1_700_000_200
      }
    ]);
  } finally {
    connection.closeDatabase();
  }
});

test('adds the SQLite database, WAL and SHM file sizes without exposing an absolute path', () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'easypoll-settings-size-'));
  const databasePath = path.join(temporaryRoot, 'settings.db');
  const { connection, service } = createSettings(databasePath);
  try {
    writeFileSync(`${databasePath}-wal`, Buffer.alloc(17));
    writeFileSync(`${databasePath}-shm`, Buffer.alloc(11));
    const summary = service.getStorageSummary();
    const expectedSize = statSync(databasePath).size + 28;
    assert.equal(summary.database.sizeBytes, expectedSize);
    assert.equal(summary.database.fileName, 'settings.db');
    assert.equal(summary.database.relativePath, 'data/settings.db');
    assert.equal(JSON.stringify(summary).includes(temporaryRoot), false);
  } finally {
    connection.closeDatabase();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('deleting one group cascades its local data, removes orphans and preserves shared members', () => {
  const { connection, repository } = createSettings();
  try {
    seedSettings(connection.sqlite);
    const result = repository.deleteGroupData('group-a@g.us');

    assert.deepEqual(result, {
      deleted: true,
      groupId: 'group-a@g.us',
      removed: { polls: 3, participations: 3, selections: 4, processedMessages: 2 }
    });
    assert.deepEqual(tableCounts(connection.sqlite), {
      groups: 1, members: 1, polls: 2, poll_options: 4,
      poll_votes: 1, processed_messages: 1, sync_state: 1
    });
    assert.equal(connection.sqlite.prepare('SELECT id FROM members WHERE id = ?').get('joao@c.us').id, 'joao@c.us');
    assert.equal(connection.sqlite.prepare('SELECT id FROM members WHERE id = ?').get('pedro@c.us'), undefined);
    assert.equal(connection.sqlite.prepare('SELECT name FROM groups WHERE id = ?').get('group-b@g.us').name, 'Grupo B');
  } finally {
    connection.closeDatabase();
  }
});

test('group deletion rolls back all cascades when orphan cleanup fails', () => {
  const { connection, repository } = createSettings();
  try {
    seedSettings(connection.sqlite);
    const before = tableCounts(connection.sqlite);
    connection.sqlite.exec(`
      CREATE TRIGGER fail_member_cleanup
      BEFORE DELETE ON members
      BEGIN
        SELECT RAISE(ABORT, 'forced member cleanup failure');
      END
    `);

    assert.throws(
      () => repository.deleteGroupData('group-a@g.us'),
      /forced member cleanup failure/
    );
    assert.deepEqual(tableCounts(connection.sqlite), before);
  } finally {
    connection.closeDatabase();
  }
});

test('delete all clears domain rows but preserves the database file, schema and migrations', () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'easypoll-settings-delete-all-'));
  const databasePath = path.join(temporaryRoot, 'easypoll.db');
  const { connection, repository } = createSettings(databasePath);
  try {
    seedSettings(connection.sqlite);
    const migrationsBefore = connection.sqlite
      .prepare('SELECT COUNT(*) AS count FROM __drizzle_migrations').get().count;

    assert.deepEqual(repository.deleteAllData(), {
      deleted: true,
      removed: { groups: 2, polls: 5, participations: 4, selections: 5, processedMessages: 3 }
    });
    assert.deepEqual(tableCounts(connection.sqlite), {
      groups: 0, members: 0, polls: 0, poll_options: 0,
      poll_votes: 0, processed_messages: 0, sync_state: 0
    });
    assert.equal(existsSync(databasePath), true);
    assert.equal(connection.sqlite.prepare('SELECT COUNT(*) AS count FROM __drizzle_migrations').get().count, migrationsBefore);
    connection.sqlite.prepare('INSERT INTO groups (id, name) VALUES (?, ?)')
      .run('new-group@g.us', 'Novo grupo');
    connection.sqlite.prepare(`
      INSERT INTO polls (message_id, group_id, question, created_at, allow_multiple_answers)
      VALUES (?, ?, ?, ?, ?)
    `).run('new-poll', 'new-group@g.us', 'Nova enquete', 1_800_000_000, 0);
    assert.equal(connection.sqlite.prepare('SELECT COUNT(*) AS count FROM polls').get().count, 1);
  } finally {
    connection.closeDatabase();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('delete all rolls back cascades when clearing remaining members fails', () => {
  const { connection, repository } = createSettings();
  try {
    seedSettings(connection.sqlite);
    const before = tableCounts(connection.sqlite);
    connection.sqlite.exec(`
      CREATE TRIGGER fail_delete_all_member_cleanup
      BEFORE DELETE ON members
      BEGIN
        SELECT RAISE(ABORT, 'forced delete all failure');
      END
    `);

    assert.throws(() => repository.deleteAllData(), /forced delete all failure/);
    assert.deepEqual(tableCounts(connection.sqlite), before);
  } finally {
    connection.closeDatabase();
  }
});

test('Settings modules work without loading WhatsApp, HistoryService or WhatsAppService', () => {
  const whatsappModulePath = require.resolve('whatsapp-web.js');
  const whatsappServicePath = require.resolve('../src/services/whatsapp.service');
  const historyServicePath = require.resolve('../src/services/history.service');
  const { connection, service } = createSettings();
  try {
    assert.deepEqual(service.getStorageSummary().totals, {
      groups: 0, polls: 0, participations: 0, selections: 0, processedMessages: 0
    });
    assert.equal(require.cache[whatsappModulePath], undefined);
    assert.equal(require.cache[whatsappServicePath], undefined);
    assert.equal(require.cache[historyServicePath], undefined);
  } finally {
    connection.closeDatabase();
  }
});

test('Settings API protects destructive endpoints and remains usable without WhatsApp', async () => {
  const { connection, service } = createSettings();
  seedSettings(connection.sqlite);
  const application = express();
  application.use(express.json());
  application.use('/api', createSettingsRouter(service));
  const server = await new Promise((resolve) => {
    const value = application.listen(0, '127.0.0.1', () => resolve(value));
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}/api`;

  try {
    const storageResponse = await fetch(`${baseUrl}/settings/storage`);
    assert.equal(storageResponse.status, 200);
    assert.equal((await storageResponse.json()).totals.groups, 2);

    const missingGroupConfirmation = await fetch(
      `${baseUrl}/settings/groups/${encodeURIComponent('group-a@g.us')}/data`,
      { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: '{}' }
    );
    assert.equal(missingGroupConfirmation.status, 400);
    assert.equal(tableCounts(connection.sqlite).groups, 2);

    const wrongGroupConfirmation = await fetch(
      `${baseUrl}/settings/groups/${encodeURIComponent('group-a@g.us')}/data`,
      {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmGroupId: 'group-b@g.us' })
      }
    );
    assert.equal(wrongGroupConfirmation.status, 400);
    assert.equal(tableCounts(connection.sqlite).groups, 2);

    const groupDelete = await fetch(
      `${baseUrl}/settings/groups/${encodeURIComponent('group-a@g.us')}/data`,
      {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmGroupId: 'group-a@g.us' })
      }
    );
    assert.equal(groupDelete.status, 200);
    assert.equal((await groupDelete.json()).removed.polls, 3);

    const missingDeleteAllConfirmation = await fetch(`${baseUrl}/settings/data`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: 'LIMPAR TUDO' })
    });
    assert.equal(missingDeleteAllConfirmation.status, 400);
    assert.equal(tableCounts(connection.sqlite).groups, 1);

    const deleteAll = await fetch(`${baseUrl}/settings/data`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: 'DELETE_ALL_LOCAL_DATA' })
    });
    assert.equal(deleteAll.status, 200);
    assert.equal((await deleteAll.json()).removed.groups, 1);
    assert.deepEqual(tableCounts(connection.sqlite), {
      groups: 0, members: 0, polls: 0, poll_options: 0,
      poll_votes: 0, processed_messages: 0, sync_state: 0
    });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    connection.closeDatabase();
  }
});
