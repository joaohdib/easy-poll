'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const {
  createDatabase,
  resolveDefaultDatabasePath
} = require('../src/db/database');
const { resolveMigrationsPath } = require('../src/db/migrate');

test('creates a local directory, opens SQLite through Drizzle and closes it', () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'easypoll-database-'));
  const temporaryDatabasePath = path.join(temporaryRoot, 'nested', 'easypoll.test.db');
  let connection;

  try {
    connection = createDatabase(temporaryDatabasePath);

    assert.equal(existsSync(path.dirname(temporaryDatabasePath)), true);
    assert.equal(existsSync(temporaryDatabasePath), true);
    assert.equal(connection.databasePath, path.resolve(temporaryDatabasePath));
    assert.equal(connection.checkDatabaseConnection(), true);

    connection.closeDatabase();
    assert.equal(connection.sqlite.open, false);
  } finally {
    connection?.closeDatabase();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('supports an in-memory database without loading WhatsApp', () => {
  const whatsappModulePath = require.resolve('whatsapp-web.js');
  const connection = createDatabase(':memory:');

  try {
    assert.equal(connection.databasePath, ':memory:');
    assert.equal(connection.checkDatabaseConnection(), true);
    assert.equal(require.cache[whatsappModulePath], undefined);
  } finally {
    connection.closeDatabase();
  }
});

test('resolves source and compiled modules to the same project database', () => {
  const projectRoot = path.resolve('virtual-project');
  const sourcePath = resolveDefaultDatabasePath(path.join(projectRoot, 'src', 'db'));
  const compiledPath = resolveDefaultDatabasePath(path.join(projectRoot, 'dist', 'db'));
  const expectedPath = path.join(projectRoot, 'data', 'easypoll.db');

  assert.equal(sourcePath, expectedPath);
  assert.equal(compiledPath, expectedPath);
});

test('resolves source and compiled modules to the same versioned migrations folder', () => {
  const projectRoot = path.resolve('virtual-project');
  const sourcePath = resolveMigrationsPath(path.join(projectRoot, 'src', 'db'));
  const compiledPath = resolveMigrationsPath(path.join(projectRoot, 'dist', 'db'));
  const expectedPath = path.join(projectRoot, 'drizzle');

  assert.equal(sourcePath, expectedPath);
  assert.equal(compiledPath, expectedPath);
});
