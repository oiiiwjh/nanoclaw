#!/usr/bin/env tsx
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

interface ExportPayload {
  exportedAt: string;
  databasePath: string;
  tableCounts: Record<string, number>;
  tables: Record<string, unknown[]>;
}

function printUsage(): void {
  console.error(
    'Usage: tsx scripts/export-messages-db.ts [db-path] [out-path]\n' +
      'Defaults:\n' +
      '  db-path:  store/messages.db\n' +
      '  out-path: store/messages.json',
  );
}

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  printUsage();
  process.exit(0);
}

const dbPath = path.resolve(args[0] ?? path.join('store', 'messages.db'));
const outPath = path.resolve(args[1] ?? path.join('store', 'messages.json'));

if (!fs.existsSync(dbPath)) {
  console.error(`Database file not found: ${dbPath}`);
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true });

try {
  const tables = db
    .prepare(
      `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `,
    )
    .all() as Array<{ name: string }>;

  const payload: ExportPayload = {
    exportedAt: new Date().toISOString(),
    databasePath: dbPath,
    tableCounts: {},
    tables: {},
  };

  for (const { name } of tables) {
    const rows = db.prepare(`SELECT * FROM "${name}"`).all();
    payload.tables[name] = rows;
    payload.tableCounts[name] = rows.length;
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n');

  console.log(
    `Exported ${tables.length} tables from ${dbPath} to ${outPath}`,
  );
} finally {
  db.close();
}
