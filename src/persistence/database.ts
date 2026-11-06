import { mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

export interface Migration {
  readonly version: number
  readonly name: string
  readonly sql: string
}

export class MigrationError extends Error {
  readonly version: number

  constructor(version: number, name: string, cause: unknown) {
    super(
      `Migration ${version}_${name} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
    this.name = 'MigrationError'
    this.version = version
  }
}

export class NestedTransactionError extends Error {
  constructor() {
    super('Nested SQLite transactions are not supported')
    this.name = 'NestedTransactionError'
  }
}

const DEFAULT_MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations', import.meta.url))

export function loadMigrations(directory = DEFAULT_MIGRATIONS_DIR): readonly Migration[] {
  const migrations = readdirSync(directory)
    .filter((file) => /^\d+_[a-z0-9_]+\.sql$/.test(file))
    .map((file) => {
      const match = /^(\d+)_([a-z0-9_]+)\.sql$/.exec(file)
      if (!match) throw new Error(`Invalid migration filename: ${file}`)
      return {
        version: Number(match[1]),
        name: match[2]!,
        sql: readFileSync(resolve(directory, file), 'utf8'),
      } satisfies Migration
    })
    .sort((left, right) => left.version - right.version)

  const versions = new Set<number>()
  for (const migration of migrations) {
    if (versions.has(migration.version)) {
      throw new Error(`Duplicate migration version: ${migration.version}`)
    }
    versions.add(migration.version)
  }
  return migrations
}

/**
 * Conexión SQLite única y síncrona. El orquestador serializa las escrituras
 * con transacciones BEGIN IMMEDIATE y un solo proceso escritor.
 */
export class SqliteDatabase {
  readonly path: string
  private readonly db: DatabaseSync
  private inTransaction = false
  private closed = false

  constructor(path: string) {
    this.path = path
    if (path !== ':memory:') {
      mkdirSync(dirname(resolve(path)), { recursive: true })
    }
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA foreign_keys = ON')
    this.db.exec('PRAGMA busy_timeout = 5000')
    this.db.exec('PRAGMA synchronous = NORMAL')
    if (path !== ':memory:') {
      this.db.exec('PRAGMA journal_mode = WAL')
    }
    this.migrate()
  }

  get schemaVersion(): number {
    const row = this.db
      .prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations')
      .get() as { version: number | bigint } | undefined
    return Number(row?.version ?? 0)
  }

  migrate(migrations = loadMigrations()): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      ) STRICT
    `)
    const applied = new Set(
      (
        this.db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>
      ).map((row) => Number(row.version)),
    )

    for (const migration of migrations) {
      if (applied.has(migration.version)) continue
      try {
        this.transaction(() => {
          this.db.exec(migration.sql)
          this.db
            .prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
            .run(migration.version, migration.name, new Date().toISOString())
        })
      } catch (error) {
        throw new MigrationError(migration.version, migration.name, error)
      }
    }
  }

  exec(sql: string): void {
    this.db.exec(sql)
  }

  run(sql: string, params: readonly unknown[] = []): { changes: number; lastInsertRowid: number } {
    const result = this.db.prepare(sql).run(...(params as never[]))
    return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) }
  }

  get<T>(sql: string, params: readonly unknown[] = []): T | undefined {
    return this.db.prepare(sql).get(...(params as never[])) as T | undefined
  }

  all<T>(sql: string, params: readonly unknown[] = []): T[] {
    return this.db.prepare(sql).all(...(params as never[])) as T[]
  }

  transaction<T>(callback: () => T): T {
    if (this.inTransaction) throw new NestedTransactionError()
    this.inTransaction = true
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = callback()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        // Conservamos el error original.
      }
      throw error
    } finally {
      this.inTransaction = false
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.db.close()
  }
}
