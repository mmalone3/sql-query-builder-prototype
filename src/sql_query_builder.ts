/**
 * Type-Safe Fluent SQL Query Builder Prototype
 * --------------------------------------------
 * Demonstrates TypeScript's type-level programming features:
 *   1. Conditional types  – table filtering, operator/value matching, join nullability
 *   2. `keyof`            – schema-driven table and column autocomplete
 *   3. `infer`            – tuple head/tail inspection, row extraction, array unwrapping
 *   4. Recursive types    – arbitrary-depth WHERE ASTs & tuple column validation
 *
 * Zero runtime dependencies. Run `npm run typecheck` to check the prototype.
 */

// ============================================================================
// 1. Core Schema & Type-Level Utilities
// ============================================================================

/** A database schema maps table names to row object types. */
export type SchemaDefinition = Record<string, Record<string, unknown>>;

/** Valid table names in a schema (`keyof`). */
export type TableName<S extends SchemaDefinition> = keyof S & string;

/** Valid column names for a specific table (`keyof`). */
export type ColumnName<
  S extends SchemaDefinition,
  T extends TableName<S>,
> = keyof S[T] & string;

/** Union of all column names across every table in the schema. */
export type AllColumnNames<S extends SchemaDefinition> = {
  [T in TableName<S>]: ColumnName<S, T>;
}[TableName<S>];

/** Unwrap element type from an array using `infer`. */
export type UnwrapArray<T> = T extends readonly (infer U)[] ? U : T;

/** Make all properties of a joined row nullable for LEFT JOINs. */
export type Nullable<T> = {
  [K in keyof T]: T[K] | null;
};

/** Merge two row types, letting the right-hand table override colliding keys. */
export type MergeRows<Left, Right> = Omit<Left, keyof Right> & Right;

/** Flatten intersections for clean IDE hover tooltips. */
export type Prettify<T> = {
  [K in keyof T]: T[K];
} & {};

// ============================================================================
// 2. Conditional & Recursive Types for SELECT
// ============================================================================

/**
 * Recursive type checking whether every column in tuple `Cols` exists on `Row`.
 * Uses `infer` to split `[Head, ...Tail]` and recurses down the tuple.
 */
export type HasAllColumns<
  Row extends Record<string, unknown>,
  Cols extends readonly string[],
> = Cols extends readonly [infer Head extends string, ...infer Tail extends string[]]
  ? Head extends '*' | (keyof Row & string)
    ? HasAllColumns<Row, Tail>
    : false
  : true;

/**
 * Conditional type: given `db.select('id', 'name')`, filter `Schema` down to
 * only the tables that actually contain all selected columns.
 */
export type MatchingTables<
  S extends SchemaDefinition,
  Cols extends readonly string[],
> = {
  [T in TableName<S>]: HasAllColumns<S[T], Cols> extends true ? T : never;
}[TableName<S>];

/**
 * Conditional type: compute the exact returned row shape from a column tuple.
 * - `['*']` or empty tuple -> full `Row`
 * - `['id', 'name']`      -> `Pick<Row, 'id' | 'name'>`
 */
export type SelectedRow<
  Row extends Record<string, unknown>,
  Cols extends readonly string[],
> = Cols extends readonly []
  ? Row
  : '*' extends Cols[number]
    ? Row
    : Prettify<Pick<Row, Extract<Cols[number], keyof Row>>>;

// ============================================================================
// 3. Conditional & Recursive Types for WHERE
// ============================================================================

/**
 * Conditional type: restrict SQL operators based on the column's value type.
 * Nullable columns (`T | null`) automatically unlock `IS NULL` / `IS NOT NULL`.
 */
export type WhereOperator<V> =
  | (NonNullable<V> extends number | Date
      ? '=' | '!=' | '>' | '>=' | '<' | '<=' | 'IN' | 'BETWEEN'
      : NonNullable<V> extends string
        ? '=' | '!=' | 'LIKE' | 'ILIKE' | 'IN'
        : NonNullable<V> extends boolean
          ? '=' | '!='
          : '=' | '!=')
  | (null extends V ? 'IS NULL' | 'IS NOT NULL' : never);

/**
 * Conditional type: infer the expected right-hand-side value type from `(V, Op)`.
 */
export type OperatorValue<V, Op extends WhereOperator<V>> = Op extends
  | 'IS NULL'
  | 'IS NOT NULL'
  ? never
  : Op extends 'IN'
    ? readonly NonNullable<V>[]
    : Op extends 'BETWEEN'
      ? readonly [NonNullable<V>, NonNullable<V>]
      : NonNullable<V>;

/**
 * Conditional tuple type: omit the 3rd argument for unary null-check operators.
 */
export type OperatorArgs<V, Op extends WhereOperator<V>> = Op extends
  | 'IS NULL'
  | 'IS NOT NULL'
  ? []
  : [value: OperatorValue<V, Op>];

/** A single typed leaf predicate bound to a column on `Row`. */
export type WhereLeaf<Row extends Record<string, unknown>> = {
  [K in keyof Row & string]: {
    readonly kind: 'leaf';
    readonly column: K;
    readonly operator: WhereOperator<Row[K]>;
    readonly value?: unknown;
  };
}[keyof Row & string];

/**
 * Recursive type definition: arbitrary-depth boolean expression tree
 * supporting nested `AND`, `OR`, and `NOT` clauses.
 */
export type WhereExpr<Row extends Record<string, unknown>> =
  | WhereLeaf<Row>
  | { readonly kind: 'and'; readonly conditions: readonly WhereExpr<Row>[] }
  | { readonly kind: 'or'; readonly conditions: readonly WhereExpr<Row>[] }
  | { readonly kind: 'not'; readonly condition: WhereExpr<Row> };

type InternalWhereExpr =
  | {
      readonly kind: 'leaf';
      readonly column: string;
      readonly operator: string;
      readonly value?: unknown;
    }
  | { readonly kind: 'and' | 'or'; readonly conditions: readonly InternalWhereExpr[] }
  | { readonly kind: 'not'; readonly condition: InternalWhereExpr };

/** Callable expression builder passed to `.where((eb) => ...)`. */
export interface ExprBuilder<Row extends Record<string, unknown>> {
  <Col extends keyof Row & string, Op extends WhereOperator<Row[Col]>>(
    column: Col,
    operator: Op,
    ...args: OperatorArgs<Row[Col], Op>
  ): WhereExpr<Row>;
  and(...conditions: readonly WhereExpr<Row>[]): WhereExpr<Row>;
  or(...conditions: readonly WhereExpr<Row>[]): WhereExpr<Row>;
  not(condition: WhereExpr<Row>): WhereExpr<Row>;
}

// ============================================================================
// 4. Query AST & Execution Types (with `infer` helpers)
// ============================================================================

export type SortDirection = 'ASC' | 'DESC';

export interface CompiledQuery<Row> {
  readonly sql: string;
  readonly params: readonly unknown[];
  /** Phantom field carrying the inferred row type for `InferRow<Q>`. */
  readonly __rowType?: Row;
}

/** Extract the inferred row type from any query builder or compiled query. */
export type InferRow<Q> = Q extends { compile(): CompiledQuery<infer Row> }
  ? Row
  : Q extends CompiledQuery<infer Row>
    ? Row
    : never;

interface InternalQueryState {
  table: string;
  columns: readonly string[];
  joins: Array<{
    type: 'INNER' | 'LEFT';
    table: string;
    leftCol: string;
    rightCol: string;
  }>;
  wheres: InternalWhereExpr[];
  orderBy: Array<{ column: string; direction: SortDirection }>;
  limitValue?: number;
  offsetValue?: number;
}

// ============================================================================
// 5. Fluent Query Builder Implementation
// ============================================================================

function createExprBuilder<
  Row extends Record<string, unknown>,
>(): ExprBuilder<Row> {
  const leaf = <Col extends keyof Row & string, Op extends WhereOperator<Row[Col]>>(
    column: Col,
    operator: Op,
    ...args: OperatorArgs<Row[Col], Op>
  ): WhereExpr<Row> =>
    ({ kind: 'leaf', column, operator, value: args[0] }) as WhereLeaf<Row>;

  return Object.assign(leaf, {
    and: (...conditions: readonly WhereExpr<Row>[]): WhereExpr<Row> => ({ kind: 'and', conditions }),
    or: (...conditions: readonly WhereExpr<Row>[]): WhereExpr<Row> => ({ kind: 'or', conditions }),
    not: (condition: WhereExpr<Row>): WhereExpr<Row> => ({ kind: 'not', condition }),
  });
}

function compileWhereExpr(
  expr: InternalWhereExpr,
  params: unknown[],
): string {
  switch (expr.kind) {
    case 'and': {
      if (expr.conditions.length === 0) return '1 = 1';
      return `(${expr.conditions.map((c) => compileWhereExpr(c, params)).join(' AND ')})`;
    }
    case 'or': {
      if (expr.conditions.length === 0) return '1 = 0';
      return `(${expr.conditions.map((c) => compileWhereExpr(c, params)).join(' OR ')})`;
    }
    case 'not':
      return `NOT (${compileWhereExpr(expr.condition, params)})`;
    case 'leaf': {
      if (expr.operator === 'IS NULL' || expr.operator === 'IS NOT NULL') {
        return `${expr.column} ${expr.operator}`;
      }
      if (expr.operator === 'IN') {
        const list = expr.value as readonly unknown[];
        const placeholders = list.map((item) => {
          params.push(item);
          return `$${params.length}`;
        });
        return `${expr.column} IN (${placeholders.join(', ')})`;
      }
      if (expr.operator === 'BETWEEN') {
        const [low, high] = expr.value as readonly [unknown, unknown];
        params.push(low);
        const p1 = `$${params.length}`;
        params.push(high);
        const p2 = `$${params.length}`;
        return `${expr.column} BETWEEN ${p1} AND ${p2}`;
      }
      params.push(expr.value);
      return `${expr.column} ${expr.operator} $${params.length}`;
    }
  }
}

/**
 * Intermediate builder returned by `db.select(...)` before `.from(...)` is called.
 * `.from()` only accepts tables containing all previously selected columns.
 */
export class SelectBeforeFromBuilder<
  S extends SchemaDefinition,
  Cols extends readonly string[],
> {
  constructor(private readonly columns: Cols) {}

  from<TTable extends MatchingTables<S, Cols>>(
    table: TTable,
  ): TableQueryBuilder<S, TTable, S[TTable], SelectedRow<S[TTable], Cols>> {
    return new TableQueryBuilder<
      S,
      TTable,
      S[TTable],
      SelectedRow<S[TTable], Cols>
    >({
      table,
      columns: this.columns,
      joins: [],
      wheres: [],
      orderBy: [],
    });
  }
}

/**
 * Main chainable query builder once the base table is known.
 * Tracks `TCurrentRow` (available columns for WHERE/JOIN/ORDER) separately
 * from `TOutputRow` (the exact projected row type returned on execution).
 */
export class TableQueryBuilder<
  S extends SchemaDefinition,
  TTable extends TableName<S>,
  TCurrentRow extends Record<string, unknown>,
  TOutputRow extends Record<string, unknown>,
> {
  constructor(private readonly state: InternalQueryState) {}

  private clone(patch: Partial<InternalQueryState>): InternalQueryState {
    return {
      ...this.state,
      joins: [...this.state.joins],
      wheres: [...this.state.wheres],
      orderBy: [...this.state.orderBy],
      ...patch,
    };
  }

  /** Refine or override the projected columns once the table/joins are known. */
  select<const Cols extends readonly ((keyof TCurrentRow & string) | '*')[]>(
    ...columns: Cols
  ): TableQueryBuilder<S, TTable, TCurrentRow, SelectedRow<TCurrentRow, Cols>> {
    return new TableQueryBuilder(this.clone({ columns }));
  }

  /** INNER JOIN another table, merging its columns into `TCurrentRow`. */
  innerJoin<
    TJoinTable extends TableName<S>,
    TLeftCol extends keyof TCurrentRow & string,
    TRightCol extends ColumnName<S, TJoinTable>,
  >(
    table: TJoinTable,
    leftCol: TLeftCol,
    rightCol: TRightCol,
  ): TableQueryBuilder<
    S,
    TTable,
    Prettify<MergeRows<TCurrentRow, S[TJoinTable]>>,
    TOutputRow
  > {
    return new TableQueryBuilder(
      this.clone({
        joins: [
          ...this.state.joins,
          { type: 'INNER', table, leftCol, rightCol },
        ],
      }),
    );
  }

  /** LEFT JOIN another table, marking its columns as nullable in `TCurrentRow`. */
  leftJoin<
    TJoinTable extends TableName<S>,
    TLeftCol extends keyof TCurrentRow & string,
    TRightCol extends ColumnName<S, TJoinTable>,
  >(
    table: TJoinTable,
    leftCol: TLeftCol,
    rightCol: TRightCol,
  ): TableQueryBuilder<
    S,
    TTable,
    Prettify<MergeRows<TCurrentRow, Nullable<S[TJoinTable]>>>,
    TOutputRow
  > {
    return new TableQueryBuilder(
      this.clone({
        joins: [
          ...this.state.joins,
          { type: 'LEFT', table, leftCol, rightCol },
        ],
      }),
    );
  }

  /** Filter rows using either `(col, op, value)` shorthand or a recursive `(eb) => ...` tree. */
  where<Col extends keyof TCurrentRow & string, Op extends WhereOperator<TCurrentRow[Col]>>(
    column: Col,
    operator: Op,
    ...args: OperatorArgs<TCurrentRow[Col], Op>
  ): TableQueryBuilder<S, TTable, TCurrentRow, TOutputRow>;
  where(
    exprOrFn:
      | WhereExpr<TCurrentRow>
      | ((eb: ExprBuilder<TCurrentRow>) => WhereExpr<TCurrentRow>),
  ): TableQueryBuilder<S, TTable, TCurrentRow, TOutputRow>;
  where(
    colOrFn:
      | string
      | WhereExpr<TCurrentRow>
      | ((eb: ExprBuilder<TCurrentRow>) => WhereExpr<TCurrentRow>),
    operator?: string,
    ...args: unknown[]
  ): TableQueryBuilder<S, TTable, TCurrentRow, TOutputRow> {
    let nextExpr: InternalWhereExpr;
    if (typeof colOrFn === 'function') {
      nextExpr = colOrFn(createExprBuilder<TCurrentRow>());
    } else if (typeof colOrFn === 'string') {
      if (operator === undefined) {
        throw new TypeError('A WHERE operator is required');
      }
      nextExpr = {
        kind: 'leaf',
        column: colOrFn,
        operator,
        value: args[0],
      };
    } else {
      nextExpr = colOrFn;
    }

    return new TableQueryBuilder(
      this.clone({ wheres: [...this.state.wheres, nextExpr] }),
    );
  }

  orderBy<Col extends keyof TCurrentRow & string>(
    column: Col,
    direction: SortDirection = 'ASC',
  ): TableQueryBuilder<S, TTable, TCurrentRow, TOutputRow> {
    return new TableQueryBuilder(
      this.clone({
        orderBy: [...this.state.orderBy, { column, direction }],
      }),
    );
  }

  limit(count: number): TableQueryBuilder<S, TTable, TCurrentRow, TOutputRow> {
    return new TableQueryBuilder(this.clone({ limitValue: count }));
  }

  offset(count: number): TableQueryBuilder<S, TTable, TCurrentRow, TOutputRow> {
    return new TableQueryBuilder(this.clone({ offsetValue: count }));
  }

  /** Compile to parameterized SQL (`$1, $2, ...`) without executing. */
  compile(): CompiledQuery<TOutputRow> {
    const params: unknown[] = [];
    const cols =
      this.state.columns.length > 0 ? this.state.columns.join(', ') : '*';

    const parts: string[] = [`SELECT ${cols}`, `FROM ${this.state.table}`];

    for (const join of this.state.joins) {
      parts.push(
        `${join.type} JOIN ${join.table} ON ${this.state.table}.${join.leftCol} = ${join.table}.${join.rightCol}`,
      );
    }

    if (this.state.wheres.length > 0) {
      const clauses = this.state.wheres.map((w) => compileWhereExpr(w, params));
      parts.push(`WHERE ${clauses.join(' AND ')}`);
    }

    if (this.state.orderBy.length > 0) {
      const orders = this.state.orderBy.map(
        (o) => `${o.column} ${o.direction}`,
      );
      parts.push(`ORDER BY ${orders.join(', ')}`);
    }

    if (this.state.limitValue !== undefined) {
      params.push(this.state.limitValue);
      parts.push(`LIMIT $${params.length}`);
    }

    if (this.state.offsetValue !== undefined) {
      params.push(this.state.offsetValue);
      parts.push(`OFFSET $${params.length}`);
    }

    return { sql: parts.join(' '), params };
  }

  /** Execute against an optional adapter; defaults to returning an empty typed array. */
  async execute(
    runner?: (sql: string, params: readonly unknown[]) => Promise<unknown[]>,
  ): Promise<TOutputRow[]> {
    const { sql, params } = this.compile();
    if (!runner) return [];
    return (await runner(sql, params)) as TOutputRow[];
  }
}

/** Database entry point parameterized by `Schema`. */
export class Database<S extends SchemaDefinition> {
  select<const Cols extends readonly (AllColumnNames<S> | '*')[]>(
    ...columns: Cols
  ): SelectBeforeFromBuilder<S, Cols> {
    return new SelectBeforeFromBuilder<S, Cols>(columns);
  }

  from<TTable extends TableName<S>>(
    table: TTable,
  ): TableQueryBuilder<S, TTable, S[TTable], S[TTable]> {
    return new TableQueryBuilder<S, TTable, S[TTable], S[TTable]>({
      table,
      columns: ['*'],
      joins: [],
      wheres: [],
      orderBy: [],
    });
  }
}

export function createDatabase<S extends SchemaDefinition>(): Database<S> {
  return new Database<S>();
}

// ============================================================================
// 6. Example Schema & Compile-Time Type Assertions
// ============================================================================

export type AppSchema = {
  users: {
    id: number;
    name: string;
    email: string | null;
    age: number;
    role: 'admin' | 'member';
    isActive: boolean;
  };
  posts: {
    id: number;
    authorId: number;
    title: string;
    published: boolean;
    views: number;
  };
};

// Type-level test helpers
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

const db = createDatabase<AppSchema>();

// A) `db.select(...).from(...)` infers exact projected row shape
export const q1 = db
  .select('id', 'name')
  .from('users')
  .where('age', '>=', 18)
  .where((eb) =>
    eb.and(
      eb('role', '=', 'admin'),
      eb.or(eb('email', 'IS NOT NULL'), eb('isActive', '=', true)),
    ),
  )
  .orderBy('name', 'ASC')
  .limit(10);

type Q1Row = InferRow<typeof q1>;
type _TestQ1 = Expect<Equal<Q1Row, { id: number; name: string }>>;

// B) `db.from(...).select(...)` scopes column autocomplete to `posts`
export const q2 = db
  .from('posts')
  .select('id', 'title', 'views')
  .where('views', 'BETWEEN', [100, 1000])
  .where('published', '=', true);

type Q2Row = InferRow<typeof q2>;
type _TestQ2 = Expect<
  Equal<Q2Row, { id: number; title: string; views: number }>
>;

// C) `SELECT *` preserves full table row type
export const q3 = db.select('*').from('users');
type _TestQ3 = Expect<Equal<InferRow<typeof q3>, AppSchema['users']>>;

// D) `LEFT JOIN` marks joined columns as nullable
export const q4 = db
  .from('users')
  .leftJoin('posts', 'id', 'authorId')
  .where('title', 'LIKE', '%TypeScript%')
  .select('name', 'title');

type _TestQ4 = Expect<
  Equal<InferRow<typeof q4>, { name: string; title: string | null }>
>;

// E) Negative compile-time checks (verified by `tsc --noEmit`)
// @ts-expect-error - 'posts' does not have an 'email' column
db.select('id', 'email').from('posts');

// @ts-expect-error - 'nonexistent' is not a valid column on 'users'
db.from('users').select('nonexistent');

// @ts-expect-error - '>' is not valid for boolean column 'isActive'
db.from('users').where('isActive', '>', true);

// @ts-expect-error - 'age' expects a number, not a string
db.from('users').where('age', '>=', '18');