'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../src/db/database');
const { runMigrations } = require('../src/db/migrate');
const { PERSISTED_TIMESTAMP_UNIT } = require('../src/db/schema');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const DOMAIN_TABLES = [
  'groups',
  'members',
  'poll_options',
  'poll_votes',
  'polls',
  'processed_messages',
  'sync_state'
];

function createMigratedDatabase() {
  const connection = createDatabase(':memory:');
  runMigrations(connection.db);
  return connection;
}

function insertPollFixture(sqlite, { multipleOptions = false } = {}) {
  sqlite.prepare('INSERT INTO groups (id, name) VALUES (?, ?)')
    .run('group-1', 'Grupo 1');
  sqlite.prepare('INSERT INTO members (id, display_name) VALUES (?, ?)')
    .run('member-1', 'Pessoa 1');
  sqlite.prepare(`
    INSERT INTO polls (
      message_id, group_id, creator_id, question, created_at, allow_multiple_answers
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run('poll-1', 'group-1', 'member-1', 'Pergunta?', 1_700_000_000, multipleOptions ? 1 : 0);

  const insertOption = sqlite.prepare(
    'INSERT INTO poll_options (poll_id, text, position) VALUES (?, ?, ?)'
  );
  const firstOptionId = Number(insertOption.run('poll-1', 'Opção A', 0).lastInsertRowid);
  const secondOptionId = Number(insertOption.run('poll-1', 'Opção B', 1).lastInsertRowid);

  return { firstOptionId, secondOptionId };
}

test('applies the initial migration to a fresh database', () => {
  const connection = createMigratedDatabase();
  try {
    const tables = connection.sqlite.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
        AND name NOT LIKE '__drizzle_%'
      ORDER BY name
    `).all().map(({ name }) => name);

    assert.deepEqual(tables, DOMAIN_TABLES);
  } finally {
    connection.closeDatabase();
  }
});

test('migration execution is idempotent and preserves existing data', () => {
  const connection = createMigratedDatabase();
  try {
    connection.sqlite.prepare('INSERT INTO groups (id, name) VALUES (?, ?)')
      .run('group-kept', 'Grupo preservado');
    const migrationCountBefore = connection.sqlite
      .prepare('SELECT COUNT(*) AS count FROM __drizzle_migrations')
      .get().count;

    runMigrations(connection.db);

    const migrationCountAfter = connection.sqlite
      .prepare('SELECT COUNT(*) AS count FROM __drizzle_migrations')
      .get().count;
    const group = connection.sqlite
      .prepare('SELECT name FROM groups WHERE id = ?')
      .get('group-kept');
    assert.equal(migrationCountBefore, 2);
    assert.equal(migrationCountAfter, migrationCountBefore);
    assert.deepEqual(group, { name: 'Grupo preservado' });
  } finally {
    connection.closeDatabase();
  }
});

test('enforces foreign keys on every created connection', () => {
  const connection = createMigratedDatabase();
  try {
    assert.equal(connection.sqlite.pragma('foreign_keys', { simple: true }), 1);
    assert.throws(() => {
      connection.sqlite.prepare(`
        INSERT INTO polls (
          message_id, group_id, question, created_at, allow_multiple_answers
        ) VALUES (?, ?, ?, ?, ?)
      `).run('poll-without-group', 'missing-group', 'Pergunta?', 1_700_000_000, 0);
    }, /FOREIGN KEY constraint failed/);
  } finally {
    connection.closeDatabase();
  }
});

test('deleting a poll cascades to its options and selected votes', () => {
  const connection = createMigratedDatabase();
  try {
    const { firstOptionId } = insertPollFixture(connection.sqlite);
    connection.sqlite.prepare(`
      INSERT INTO poll_votes (poll_id, voter_id, option_id, voted_at)
      VALUES (?, ?, ?, ?)
    `).run('poll-1', 'member-1', firstOptionId, 1_700_000_100);

    connection.sqlite.prepare('DELETE FROM polls WHERE message_id = ?').run('poll-1');

    assert.equal(connection.sqlite.prepare('SELECT COUNT(*) AS count FROM poll_options').get().count, 0);
    assert.equal(connection.sqlite.prepare('SELECT COUNT(*) AS count FROM poll_votes').get().count, 0);
  } finally {
    connection.closeDatabase();
  }
});

test('rejects a duplicate selected option but permits multiple choices', () => {
  const connection = createMigratedDatabase();
  try {
    const { firstOptionId, secondOptionId } = insertPollFixture(
      connection.sqlite,
      { multipleOptions: true }
    );
    const insertVote = connection.sqlite.prepare(`
      INSERT INTO poll_votes (poll_id, voter_id, option_id, voted_at)
      VALUES (?, ?, ?, ?)
    `);

    insertVote.run('poll-1', 'member-1', firstOptionId, 1_700_000_100);
    insertVote.run('poll-1', 'member-1', secondOptionId, 1_700_000_100);
    assert.equal(connection.sqlite.prepare('SELECT COUNT(*) AS count FROM poll_votes').get().count, 2);
    assert.throws(
      () => insertVote.run('poll-1', 'member-1', firstOptionId, 1_700_000_200),
      /UNIQUE constraint failed/
    );
  } finally {
    connection.closeDatabase();
  }
});

test('processed_messages stores metadata only and timestamps use integer Unix seconds', () => {
  const connection = createMigratedDatabase();
  try {
    const processedMessageColumns = connection.sqlite
      .prepare('PRAGMA table_info(processed_messages)')
      .all();
    assert.deepEqual(
      processedMessageColumns.map(({ name }) => name),
      ['message_id', 'group_id', 'message_type', 'message_timestamp']
    );

    const timestampColumns = [
      ['polls', 'created_at'],
      ['poll_votes', 'voted_at'],
      ['processed_messages', 'message_timestamp'],
      ['sync_state', 'last_sync_at'],
      ['sync_state', 'oldest_processed_timestamp'],
      ['sync_state', 'newest_processed_timestamp']
    ];
    for (const [table, column] of timestampColumns) {
      const tableInfo = connection.sqlite.prepare(`PRAGMA table_info(${table})`).all();
      assert.equal(tableInfo.find(({ name }) => name === column)?.type, 'INTEGER');
    }
    assert.equal(PERSISTED_TIMESTAMP_UNIT, 'unix-seconds');
  } finally {
    connection.closeDatabase();
  }
});

test('applies the local option ID migration over a Phase 5 database without losing data', () => {
  const connection = createDatabase(':memory:');
  try {
    applySqlMigration(connection.sqlite, '0000_sticky_karma.sql');
    connection.sqlite.prepare('INSERT INTO groups (id, name) VALUES (?, ?)')
      .run('legacy-group', 'Grupo legado');
    connection.sqlite.prepare(`
      INSERT INTO polls (
        message_id, group_id, question, created_at, allow_multiple_answers
      ) VALUES (?, ?, ?, ?, ?)
    `).run('legacy-poll', 'legacy-group', 'Pergunta preservada', 1_700_000_000, 0);
    connection.sqlite.prepare(
      'INSERT INTO poll_options (poll_id, text, position) VALUES (?, ?, ?)'
    ).run('legacy-poll', 'Opção preservada', 0);

    applySqlMigration(connection.sqlite, '0001_breezy_kylun.sql');

    const option = connection.sqlite.prepare(`
      SELECT text, position, whatsapp_local_id AS whatsappLocalId
      FROM poll_options WHERE poll_id = ?
    `).get('legacy-poll');
    assert.deepEqual(option, {
      text: 'Opção preservada', position: 0, whatsappLocalId: null
    });
    assert.ok(connection.sqlite.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'index' AND name = 'poll_options_poll_id_whatsapp_local_id_unique'
    `).get());
  } finally {
    connection.closeDatabase();
  }
});

function applySqlMigration(sqlite, filename) {
  const sql = readFileSync(path.join(__dirname, '..', 'drizzle', filename), 'utf8');
  sql.split('--> statement-breakpoint').map((statement) => statement.trim())
    .filter(Boolean).forEach((statement) => sqlite.exec(statement));
}
