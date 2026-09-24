import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const inventoryMigration = readFileSync(
  new URL(
    '../../prisma/migrations/20260924120000_inventory_equipment_persistence/migration.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('inventory migration portability', () => {
  it('keeps RLS and conditionally revokes fixed Supabase roles', () => {
    expect(inventoryMigration).toContain('ALTER TABLE "item_instances" ENABLE ROW LEVEL SECURITY;');
    expect(inventoryMigration).toContain(
      'ALTER TABLE "character_equipment" ENABLE ROW LEVEL SECURITY;',
    );
    expect(inventoryMigration).toContain("ARRAY['anon', 'authenticated']");
    expect(inventoryMigration).toContain(
      'IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role)',
    );
    expect(inventoryMigration).toContain('FROM %I');
    expect(inventoryMigration).not.toMatch(/FROM\s+anon(?:\s|,|;)/u);
    expect(inventoryMigration).not.toMatch(/FROM\s+authenticated(?:\s|,|;)/u);
  });
});
