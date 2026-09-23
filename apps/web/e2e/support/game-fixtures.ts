import pg from 'pg';

/**
 * Deterministic game-state fixtures for end-to-end tests.
 *
 * Tests reach the database directly only to *arrange* a state the gameplay
 * loop would take minutes to reach (a boss stage). Every assertion still goes
 * through the browser and the real API. Uses the same database the suite's API
 * process uses (playwright.config.ts).
 */
const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgresql://forge:forge@127.0.0.1:5432/eternal_forge';

/** Moves the hero named `heroName` (unique per test account) to `stage`. */
export async function placeHeroOnStage(heroName: string, stage: bigint): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query('UPDATE characters SET stage = $1 WHERE name = $2', [
      stage.toString(),
      heroName,
    ]);
    if (result.rowCount !== 1) {
      throw new Error(`Expected one hero named ${heroName}, updated ${String(result.rowCount)}`);
    }
  } finally {
    await client.end();
  }
}
