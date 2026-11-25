import assert from 'node:assert/strict';
import test from 'node:test';
import { createDatabase, q1, q2, q4 } from '../dist/sql_query_builder.js';

test('compiles nested predicates and parameters in order', () => {
  assert.deepEqual(q1.compile(), {
    sql: 'SELECT id, name FROM users WHERE age >= $1 AND (role = $2 AND (email IS NOT NULL OR isActive = $3)) ORDER BY name ASC LIMIT $4',
    params: [18, 'admin', true, 10],
  });
  assert.deepEqual(q2.compile(), {
    sql: 'SELECT id, title, views FROM posts WHERE views BETWEEN $1 AND $2 AND published = $3',
    params: [100, 1000, true],
  });
  assert.deepEqual(q4.compile(), {
    sql: 'SELECT name, title FROM users LEFT JOIN posts ON users.id = posts.authorId WHERE title LIKE $1',
    params: ['%TypeScript%'],
  });
});

test('keeps values parameterized and builder branches independent', () => {
  const db = createDatabase();
  const base = db.from('users');
  const first = base.where('name', '=', "'; DROP TABLE users; --");
  const second = base.where('id', 'IN', [1, 2]).offset(3);

  assert.deepEqual(base.compile(), { sql: 'SELECT * FROM users', params: [] });
  assert.deepEqual(first.compile(), {
    sql: 'SELECT * FROM users WHERE name = $1',
    params: ["'; DROP TABLE users; --"],
  });
  assert.deepEqual(second.compile(), {
    sql: 'SELECT * FROM users WHERE id IN ($1, $2) OFFSET $3',
    params: [1, 2, 3],
  });
});

test('compiles empty and negated boolean groups', () => {
  const db = createDatabase();
  const query = db.from('users').where((eb) =>
    eb.and(eb.or(), eb.not(eb('email', 'IS NULL'))),
  );
  assert.deepEqual(query.compile(), {
    sql: 'SELECT * FROM users WHERE (1 = 0 AND NOT (email IS NULL))',
    params: [],
  });
});

test('rejects a missing WHERE operator', () => {
  const db = createDatabase();
  assert.throws(() => db.from('users').where('id'), /WHERE operator is required/);
});

test('passes compiled SQL to the runner and propagates errors', async () => {
  const rows = [{ id: 1, name: 'Ada' }];
  const result = await q1.execute(async (sql, params) => {
    assert.deepEqual({ sql, params }, q1.compile());
    return rows;
  });
  assert.deepEqual(result, rows);
  const error = new Error('database unavailable');
  await assert.rejects(q1.execute(async () => { throw error; }), error);
});
