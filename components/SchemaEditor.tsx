'use client';

import { useState, useEffect } from 'react';
import { Plus, Trash2, Save, Key, Table2, ShieldAlert, AlertTriangle } from 'lucide-react';
import type { DatabaseConnection, SchemaColumn, SchemaTable } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Result from the server-side NULL check endpoint. */
interface NullColumnInfo {
  column: string;
  columnName: string;
  nullCount: number;
  type: string;
  backfillSql: string;
  description: string;
}

interface NullCheckResult {
  columns: NullColumnInfo[];
  needsBackfill: boolean;
}

interface SchemaEditorProps {
  connection: DatabaseConnection;
  selectedTable: string | null;
  showConfirmation: (message: string, onConfirm: () => void) => void;
  showNotification: (message: string, type: 'success' | 'error') => void;
  onRefreshSchema: () => void;
}

type EditableColumn = SchemaColumn & {
  originalName?: string;
  isNew?: boolean;
  isDeleted?: boolean;
  isModified?: boolean;
};

const DB_DATA_TYPES = {
  sqlite: ['INTEGER', 'TEXT', 'REAL', 'BLOB', 'NUMERIC'],
  postgresql: [
    'INTEGER',
    'BIGINT',
    'VARCHAR(255)',
    'TEXT',
    'BOOLEAN',
    'TIMESTAMP',
    'DOUBLE PRECISION',
    'JSONB',
  ],
  mysql: [
    'INT',
    'BIGINT',
    'VARCHAR(255)',
    'TEXT',
    'TINYINT(1)',
    'DATETIME',
    'DECIMAL(10,2)',
    'JSON',
  ],
  mariadb: [
    'INT',
    'BIGINT',
    'VARCHAR(255)',
    'TEXT',
    'TINYINT(1)',
    'DATETIME',
    'DECIMAL(10,2)',
    'JSON',
  ],
};

export function SchemaEditor({
  connection,
  selectedTable,
  showConfirmation,
  showNotification,
  onRefreshSchema,
}: SchemaEditorProps) {
  const [columns, setColumns] = useState<EditableColumn[]>([]);
  const [originalColumns, setOriginalColumns] = useState<SchemaColumn[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [nullWarnings, setNullWarnings] = useState<NullColumnInfo[]>([]);
  const [checkingNulls, setCheckingNulls] = useState(false);

  // Load schema for selected table
  useEffect(() => {
    if (!selectedTable) return;

    const fetchTableSchema = async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/schema');
        if (res.ok) {
          const data = await res.json();
          const table = (data.tables || []).find((t: SchemaTable) => t.name === selectedTable);
          if (table) {
            const cols = (table.columns || []).map((c: SchemaColumn) => ({
              ...c,
              originalName: c.name,
            }));
            setColumns(cols);
            setOriginalColumns(JSON.parse(JSON.stringify(table.columns)));
          }
        }
      } catch (err) {
        console.error('Failed to load table schema:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchTableSchema();
  }, [selectedTable]);

  if (!selectedTable) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center bg-muted/20 p-8 text-center">
        <Table2 className="mb-4 h-12 w-12 text-muted-foreground/60" />
        <h2 className="text-xl font-semibold tracking-tight">Schema Editor</h2>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          Click the <span className="font-medium text-foreground">Schema Editor</span> button in the
          header and pick a table to view, add, modify, or delete columns and constraints.
        </p>
      </div>
    );
  }

  const dataTypes = DB_DATA_TYPES[connection.type] || DB_DATA_TYPES.sqlite;

  const handleAddColumn = () => {
    const defaultType = dataTypes[0];
    const newCol: EditableColumn = {
      name: `new_column_${columns.length + 1}`,
      type: defaultType,
      nullable: true,
      defaultValue: null,
      primaryKey: false,
      unique: false,
      autoIncrement: false,
      foreignKey: null,
      isNew: true,
    };
    setColumns([...columns, newCol]);
  };

  const handleUpdateField = (index: number, field: keyof EditableColumn, value: any) => {
    const updated = [...columns];
    updated[index] = {
      ...updated[index],
      [field]: value,
      isModified: !updated[index].isNew,
    };

    // Auto-adjust rules
    if (field === 'primaryKey' && value === true) {
      updated[index].nullable = false; // Primary keys cannot be nullable
    }

    setColumns(updated);
  };

  const handleDeleteColumn = (index: number) => {
    const target = columns[index];
    if (target.isNew) {
      // Unsaved new column, filter it out immediately
      setColumns(columns.filter((_, i) => i !== index));
    } else {
      // Existing column, mark as deleted
      const updated = [...columns];
      updated[index] = { ...target, isDeleted: true };
      setColumns(updated);
    }
  };

  const handleUndoDelete = (index: number) => {
    const updated = [...columns];
    updated[index] = { ...updated[index], isDeleted: false };
    setColumns(updated);
  };

  /**
   * Identify columns being changed from nullable to NOT NULL.
   * These are the candidates that need a NULL-value check.
   */
  const getNotNullCandidates = (): { columnName: string; type: string }[] => {
    const candidates: { columnName: string; type: string }[] = [];
    columns.forEach((c) => {
      if (c.isNew || c.isDeleted) return;
      const origName = c.originalName || c.name;
      const origCol = originalColumns.find((o) => o.name === origName);
      if (origCol && origCol.nullable && !c.nullable) {
        candidates.push({ columnName: c.name, type: c.type });
      }
    });
    return candidates;
  };

  /**
   * Query the server to check whether any of the given columns contain NULL values.
   */
  const fetchNullCheck = async (
    candidates: { columnName: string; type: string }[]
  ): Promise<NullColumnInfo[]> => {
    if (candidates.length === 0 || connection.type === 'sqlite') return [];

    setCheckingNulls(true);
    try {
      const res = await fetch('/api/schema/null-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table: selectedTable, columns: candidates }),
      });
      if (!res.ok) return [];
      const data: NullCheckResult = await res.json();
      return data.columns || [];
    } catch {
      return [];
    } finally {
      setCheckingNulls(false);
    }
  };

  // Generate DDL statements
  const getMigrationStatements = (backfillColumns: NullColumnInfo[] = []): string[] => {
    const sqls: string[] = [];
    const dbType = connection.type;
    const activeCols = columns.filter((c) => !c.isDeleted);

    // Build a set of column names that need backfill, for quick lookup.
    const backfillSet = new Map<string, string>();
    for (const bc of backfillColumns) {
      backfillSet.set(bc.columnName, bc.backfillSql);
    }

    if (dbType === 'sqlite') {
      // Table recreate pattern for SQLite due to ALTER TABLE limits
      const colDefs = activeCols.map((c) => {
        let def = `"${c.name}" ${c.type}`;
        if (c.primaryKey) def += ' PRIMARY KEY';
        if (c.autoIncrement && c.type.toUpperCase().includes('INT')) def += ' AUTOINCREMENT';
        if (!c.nullable) def += ' NOT NULL';
        if (c.unique && !c.primaryKey) def += ' UNIQUE';
        if (c.defaultValue !== null && c.defaultValue !== undefined && c.defaultValue !== '') {
          def += ` DEFAULT ${c.defaultValue}`;
        }
        if (c.foreignKey?.table && c.foreignKey?.column) {
          def += ` REFERENCES "${c.foreignKey.table}"("${c.foreignKey.column}")`;
        }
        return def;
      });

      const tempTableName = `${selectedTable}_temp_migration`;
      sqls.push(`PRAGMA foreign_keys=OFF;`);
      sqls.push(`BEGIN TRANSACTION;`);

      // Before recreating the table, backfill NULLs in columns becoming NOT NULL
      // so the INSERT INTO ... SELECT doesn't fail.
      if (backfillColumns.length > 0) {
        for (const bc of backfillColumns) {
          sqls.push(bc.backfillSql.replace(/`/g, '"').replace(/"/g, '"'));
        }
      }

      sqls.push(`CREATE TABLE "${tempTableName}" (\n  ${colDefs.join(',\n  ')}\n);`);

      // Copy matching data columns
      const copyPairs: { from: string; to: string }[] = [];
      activeCols.forEach((c) => {
        if (!c.isNew) {
          const origName = c.originalName || c.name;
          const origCol = originalColumns.find((o) => o.name === origName);
          if (origCol) {
            copyPairs.push({ from: origCol.name, to: c.name });
          }
        }
      });

      if (copyPairs.length > 0) {
        const fromCols = copyPairs.map((p) => `"${p.from}"`).join(', ');
        const toCols = copyPairs.map((p) => `"${p.to}"`).join(', ');
        sqls.push(`INSERT INTO "${tempTableName}" (${toCols}) SELECT ${fromCols} FROM "${selectedTable}";`);
      }

      sqls.push(`DROP TABLE "${selectedTable}";`);
      sqls.push(`ALTER TABLE "${tempTableName}" RENAME TO "${selectedTable}";`);
      sqls.push(`COMMIT;`);
      sqls.push(`PRAGMA foreign_keys=ON;`);
    } else {
      const escape = (name: string) => (dbType === 'mysql' || dbType === 'mariadb' ? `\`${name}\`` : `"${name}"`);
      const tblEscaped = escape(selectedTable);

      // 1. DROP columns
      columns.forEach((c) => {
        if (c.isDeleted && !c.isNew) {
          sqls.push(`ALTER TABLE ${tblEscaped} DROP COLUMN ${escape(c.originalName || c.name)};`);
        }
      });

      // 2. RENAME columns
      columns.forEach((c) => {
        if (!c.isDeleted && !c.isNew && c.originalName && c.originalName !== c.name) {
          sqls.push(`ALTER TABLE ${tblEscaped} RENAME COLUMN ${escape(c.originalName)} TO ${escape(c.name)};`);
        }
      });

      // 3. ADD columns
      columns.forEach((c) => {
        if (c.isNew && !c.isDeleted) {
          let def = `${escape(c.name)} ${c.type}`;
          if (c.primaryKey) def += ' PRIMARY KEY';
          if (c.autoIncrement) {
            def += dbType === 'postgresql' ? ' GENERATED BY DEFAULT AS IDENTITY' : ' AUTO_INCREMENT';
          }
          if (!c.nullable) def += ' NOT NULL';
          if (c.unique && !c.primaryKey) def += ' UNIQUE';
          if (c.defaultValue !== null && c.defaultValue !== undefined && c.defaultValue !== '') {
            def += ` DEFAULT ${c.defaultValue}`;
          }
          if (c.foreignKey?.table && c.foreignKey?.column) {
            def += ` REFERENCES ${escape(c.foreignKey.table)}(${escape(c.foreignKey.column)})`;
          }
          sqls.push(`ALTER TABLE ${tblEscaped} ADD COLUMN ${def};`);
        }
      });

      // 4. ALTER columns (Types, Default Values, Constraints)
      columns.forEach((c) => {
        if (!c.isNew && !c.isDeleted) {
          const origName = c.originalName || c.name;
          const origCol = originalColumns.find((o) => o.name === origName);
          if (origCol) {
            const colEscaped = escape(c.name);

            // Change Type
            if (origCol.type !== c.type) {
              if (dbType === 'postgresql') {
                sqls.push(`ALTER TABLE ${tblEscaped} ALTER COLUMN ${colEscaped} TYPE ${c.type};`);
              } else {
                sqls.push(`ALTER TABLE ${tblEscaped} MODIFY COLUMN ${colEscaped} ${c.type};`);
              }
            }

            // Change Nullable
            if (origCol.nullable !== c.nullable) {
              if (dbType === 'postgresql') {
                if (c.nullable) {
                  sqls.push(`ALTER TABLE ${tblEscaped} ALTER COLUMN ${colEscaped} DROP NOT NULL;`);
                } else {
                  // Before adding NOT NULL, backfill any existing NULLs
                  const backfill = backfillSet.get(c.name);
                  if (backfill) {
                    sqls.push(backfill);
                  }
                  sqls.push(`ALTER TABLE ${tblEscaped} ALTER COLUMN ${colEscaped} SET NOT NULL;`);
                }
              } else {
                if (!c.nullable) {
                  // Before MODIFY COLUMN ... NOT NULL, backfill any existing NULLs
                  const backfill = backfillSet.get(c.name);
                  if (backfill) {
                    sqls.push(backfill);
                  }
                }
                sqls.push(`ALTER TABLE ${tblEscaped} MODIFY COLUMN ${colEscaped} ${c.type} ${c.nullable ? 'NULL' : 'NOT NULL'};`);
              }
            }

            // Change Default
            if (origCol.defaultValue !== c.defaultValue) {
              if (c.defaultValue === null || c.defaultValue === '') {
                sqls.push(`ALTER TABLE ${tblEscaped} ALTER COLUMN ${colEscaped} DROP DEFAULT;`);
              } else {
                sqls.push(`ALTER TABLE ${tblEscaped} ALTER COLUMN ${colEscaped} SET DEFAULT ${c.defaultValue};`);
              }
            }

            // Add Unique
            if (!origCol.unique && c.unique) {
              sqls.push(`ALTER TABLE ${tblEscaped} ADD UNIQUE (${colEscaped});`);
            }
          }
        }
      });
    }

    return sqls;
  };

  const handleSaveSchema = async () => {
    const statements = getMigrationStatements();

    if (statements.length === 0) {
      showNotification('No schema modifications detected.', 'success');
      return;
    }

    // Check for NULL values in columns that are becoming NOT NULL
    const candidates = getNotNullCandidates();
    let backfillColumns: NullColumnInfo[] = [];
    if (candidates.length > 0) {
      backfillColumns = await fetchNullCheck(candidates);
      setNullWarnings(backfillColumns);
    } else {
      setNullWarnings([]);
    }

    // Regenerate migration SQL with backfill statements included
    const finalStatements = getMigrationStatements(backfillColumns);
    const migrationSql = finalStatements.join('\n');

    // Build a warning message if backfill is needed
    let warningSuffix = '';
    if (backfillColumns.length > 0) {
      const lines = backfillColumns.map(
        (bc) => `• ${bc.description}`
      );
      warningSuffix = `\n\n⚠️ NULL Value Backfill Required:\n${lines.join('\n')}\n\nThe UPDATE statements above will run automatically before applying the NOT NULL constraint.`;
    }

    showConfirmation(
      `Confirm schema changes for "${selectedTable}"?\n\nThe following statements will be executed:\n\n${migrationSql}${warningSuffix}`,
      async () => {
        setSaving(true);
        try {
          const res = await fetch('/api/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sql: migrationSql }),
          });

          if (!res.ok) {
            const errData = await res.json();
            throw new Error(errData.error || 'Failed to update schema');
          }

          showNotification('Schema changes saved successfully!', 'success');
          setNullWarnings([]);
          onRefreshSchema();
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          showNotification(`Schema save failed: ${msg}`, 'error');
        } finally {
          setSaving(false);
        }
      }
    );
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between border-b border-border pb-4">
        <div className="flex items-center gap-2.5">
          <Table2 className="h-5 w-5 text-muted-foreground" />
          <div>
            <h1 className="text-lg font-semibold text-foreground">Editing Table: {selectedTable}</h1>
            <p className="text-xs text-muted-foreground capitalize">Dialect: {connection.type}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleAddColumn}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold hover:bg-muted/50"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Column
          </button>
          <button
            type="button"
            onClick={handleSaveSchema}
            disabled={saving || loading || checkingNulls}
            className="flex items-center gap-1.5 rounded-lg bg-foreground px-3.5 py-1.5 text-xs font-semibold text-background hover:bg-foreground/90 disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            {checkingNulls ? 'Checking...' : saving ? 'Saving...' : 'Save Schema'}
          </button>
        </div>
      </div>

      {/* Grid Container */}
      <div className="flex-1 overflow-auto rounded-xl border border-border bg-white">
        {loading ? (
          <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
            Loading schema definitions...
          </div>
        ) : (
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/30 font-medium text-muted-foreground">
                <th className="p-3">Name</th>
                <th className="p-3">Type</th>
                <th className="p-3">Nullable</th>
                <th className="p-3">Default</th>
                <th className="p-3 text-center">PK</th>
                <th className="p-3 text-center">Unique</th>
                {connection.type !== 'sqlite' && <th className="p-3 text-center">Auto Inc</th>}
                <th className="p-3">Foreign Key</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {columns.map((col, idx) => (
                <tr
                  key={idx}
                  className={cn(
                    'border-b border-border hover:bg-muted/10 transition-colors',
                    col.isDeleted && 'bg-red-50/50 opacity-60 line-through',
                    col.isNew && 'bg-emerald-50/20'
                  )}
                >
                  {/* Name */}
                  <td className="p-3">
                    <input
                      type="text"
                      value={col.name}
                      disabled={col.isDeleted}
                      onChange={(e) => handleUpdateField(idx, 'name', e.target.value)}
                      className={cn(
                        'w-full rounded border border-border bg-muted/10 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary',
                        col.isNew && 'font-semibold text-emerald-800'
                      )}
                    />
                  </td>

                  {/* Type */}
                  <td className="p-3">
                    <select
                      value={col.type.toUpperCase()}
                      disabled={col.isDeleted}
                      onChange={(e) => handleUpdateField(idx, 'type', e.target.value)}
                      className="rounded border border-border bg-white px-1.5 py-1 focus:outline-none focus:ring-1"
                    >
                      {dataTypes.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </td>

                  {/* Nullable */}
                  <td className="p-3">
                    <input
                      type="checkbox"
                      checked={col.nullable}
                      disabled={col.isDeleted || col.primaryKey}
                      onChange={(e) => handleUpdateField(idx, 'nullable', e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-border"
                    />
                  </td>

                  {/* Default Value */}
                  <td className="p-3">
                    <input
                      type="text"
                      value={col.defaultValue || ''}
                      placeholder="NULL"
                      disabled={col.isDeleted}
                      onChange={(e) => handleUpdateField(idx, 'defaultValue', e.target.value || null)}
                      className="w-24 rounded border border-border bg-white px-2 py-1 focus:outline-none"
                    />
                  </td>

                  {/* Primary Key */}
                  <td className="p-3 text-center">
                    <input
                      type="checkbox"
                      checked={col.primaryKey}
                      disabled={col.isDeleted}
                      onChange={(e) => handleUpdateField(idx, 'primaryKey', e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-border"
                    />
                  </td>

                  {/* Unique */}
                  <td className="p-3 text-center">
                    <input
                      type="checkbox"
                      checked={col.unique}
                      disabled={col.isDeleted}
                      onChange={(e) => handleUpdateField(idx, 'unique', e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-border"
                    />
                  </td>

                  {/* Auto Increment */}
                  {connection.type !== 'sqlite' && (
                    <td className="p-3 text-center">
                      <input
                        type="checkbox"
                        checked={col.autoIncrement}
                        disabled={col.isDeleted || !col.primaryKey}
                        onChange={(e) => handleUpdateField(idx, 'autoIncrement', e.target.checked)}
                        className="h-3.5 w-3.5 rounded border-border"
                      />
                    </td>
                  )}

                  {/* Foreign Key */}
                  <td className="p-3">
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        placeholder="Table"
                        value={col.foreignKey?.table || ''}
                        disabled={col.isDeleted}
                        onChange={(e) => {
                          const table = e.target.value;
                          const column = col.foreignKey?.column || 'id';
                          handleUpdateField(
                            idx,
                            'foreignKey',
                            table ? { table, column } : null
                          );
                        }}
                        className="w-16 rounded border border-border bg-white px-1.5 py-0.5 focus:outline-none text-[11px]"
                      />
                      <input
                        type="text"
                        placeholder="Col"
                        value={col.foreignKey?.column || ''}
                        disabled={col.isDeleted}
                        onChange={(e) => {
                          const column = e.target.value;
                          const table = col.foreignKey?.table || '';
                          handleUpdateField(
                            idx,
                            'foreignKey',
                            table ? { table, column } : null
                          );
                        }}
                        className="w-12 rounded border border-border bg-white px-1.5 py-0.5 focus:outline-none text-[11px]"
                      />
                    </div>
                  </td>

                  {/* Actions */}
                  <td className="p-3 text-right">
                    {col.isDeleted ? (
                      <button
                        type="button"
                        onClick={() => handleUndoDelete(idx)}
                        className="text-xs font-semibold text-primary hover:underline"
                      >
                        Undo
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleDeleteColumn(idx)}
                        className="rounded p-1 text-muted-foreground hover:bg-red-50 hover:text-red-600 transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* NULL Value Warnings */}
      {nullWarnings.length > 0 && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-xs leading-relaxed">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
          <div>
            <p className="font-semibold text-amber-800">
              NULL Values Detected — Auto-Backfill Will Apply
            </p>
            <p className="mt-0.5 text-amber-700">
              The following columns contain NULL values. Before adding the NOT NULL constraint,
              the migration will automatically update these rows:
            </p>
            <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-amber-700">
              {nullWarnings.map((w) => (
                <li key={w.columnName}>
                  <span className="font-mono font-medium">{w.columnName}</span>
                  {' '}(type: {w.type}): {w.nullCount} row(s) will be set to{' '}
                  <code className="rounded bg-amber-100 px-1">{w.backfillSql.match(/=\s*(.+)/)?.[1]?.replace(';', '').trim()}</code>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Warnings / Hints */}
      <div className="mt-4 flex items-start gap-2 rounded-xl bg-muted/40 p-4 text-xs text-muted-foreground leading-relaxed">
        <ShieldAlert className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div>
          <p className="font-semibold text-foreground">Safety Advisory</p>
          <p className="mt-0.5">
            Updating the schema of a database containing data can lead to data loss or integrity issues (e.g. adding a NOT NULL constraint without a default value, or dropping a column). Make sure you verify the generated migration script in the confirmation box before execution.
          </p>
        </div>
      </div>
    </div>
  );
}
