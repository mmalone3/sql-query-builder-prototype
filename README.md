# Type-safe SQL query builder

A TypeScript prototype for building parameterized PostgreSQL-style SELECT
queries. Its schema types drive table and column completion and infer the
selected row shape.

## Setup

Install Node.js 22 or later, then run:

```powershell
npm ci
npm run typecheck
npm test
npm run build
```

The build produces JavaScript and type declarations in `dist`. In VS Code,
select **TypeScript: Select TypeScript Version** and choose **Use Workspace
Version** for completion using the project's TypeScript version.

## Example

```typescript
import { createDatabase, type InferRow } from './sql_query_builder.js';

type Schema = {
  users: { id: number; name: string; age: number };
};

const db = createDatabase<Schema>();
const query = db.select('id', 'name').from('users').where('age', '>=', 18);

type Row = InferRow<typeof query>; // { id: number; name: string }
const { sql, params } = query.compile();
// SELECT id, name FROM users WHERE age >= $1
// [18]
```

`db.from('users').select(...)` limits column suggestions to that table;
`db.select(...).from(...)` restricts the table to ones containing the selected
columns. `where` also accepts a callback for nested `and`, `or`, and `not`
expressions. `execute(runner)` passes SQL and parameters to an async adapter;
without a runner it returns an empty array and does not connect to a database.
The adapter is responsible for returning rows matching the inferred type.

## Prototype limitations

This is not a production SQL engine. Identifiers are interpolated without
quoting or runtime validation: use only trusted schema and identifier values.
Values are parameterized. Joins do not handle ambiguous column names, aliases,
or left-hand columns from earlier joined tables. Select explicit, unambiguous
columns after a join: wildcard projections and overlapping column names can
produce results that do not match the inferred row type. An empty `IN` list
produces invalid SQL. There is no built-in database adapter or result
validation.
