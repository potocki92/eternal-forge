import { randomUUID } from 'node:crypto';
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

/** Creates trusted test setup directly; player behavior still uses the real API. */
export async function grantItem(
  heroName: string,
  definitionId: string,
  rarity: string,
  equipped = false,
): Promise<string> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const id = randomUUID();
  try {
    const result = await client.query(
      `INSERT INTO item_instances (id, character_id, definition_id, rarity)
       SELECT $1, id, $2, $3 FROM characters WHERE name = $4 RETURNING id`,
      [id, definitionId, rarity, heroName],
    );
    if (result.rowCount !== 1) throw new Error(`Expected hero named ${heroName}`);
    if (equipped) {
      const slot = definitionId === 'forged_iron_sword' ? 'WEAPON' : 'RING';
      await client.query(
        `INSERT INTO character_equipment (character_id, slot, item_instance_id)
         SELECT character_id, $2, id FROM item_instances WHERE id = $1`,
        [id, slot],
      );
    }
    return id;
  } finally {
    await client.end();
  }
}

/**
 * Moves the hero named `heroName` (unique per test account) to `stage` as a
 * hero pushing its record would stand there: `stage` reached, every earlier
 * stage cleared (ADR-020). The database CHECKs reject an inconsistent state.
 */
export async function placeHeroOnStage(heroName: string, stage: bigint): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query(
      `UPDATE characters
          SET current_stage = $1, highest_stage_reached = $1, highest_stage_cleared = $2
        WHERE name = $3`,
      [stage.toString(), stage > 1n ? (stage - 1n).toString() : null, heroName],
    );
    if (result.rowCount !== 1) {
      throw new Error(`Expected one hero named ${heroName}, updated ${String(result.rowCount)}`);
    }
  } finally {
    await client.end();
  }
}

export interface RecordedCombat {
  readonly stage: string;
  readonly stageMode: string;
  readonly createdAt: Date;
  readonly durationMs: number;
}

/**
 * The combats the server recorded for the hero named `heroName`, oldest
 * first. Read-only: used to prove what the server accepted, never to arrange.
 */
export async function recordedCombats(heroName: string): Promise<RecordedCombat[]> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query<{
      stage: string;
      stage_mode: string;
      created_at: Date;
      duration_ms: number;
    }>(
      `SELECT r.stage::text AS stage, r.stage_mode, r.created_at, r.duration_ms
         FROM combat_runs r JOIN characters c ON c.id = r.character_id
        WHERE c.name = $1
        ORDER BY r.created_at`,
      [heroName],
    );
    return result.rows.map((row) => ({
      stage: row.stage,
      stageMode: row.stage_mode,
      createdAt: row.created_at,
      durationMs: row.duration_ms,
    }));
  } finally {
    await client.end();
  }
}

/**
 * Makes the hero named `heroName` idle for `awayMs`, as if the player had
 * closed the game that long ago: the server's processed boundary
 * (`next_combat_at`) is moved into the past on the database clock. This is
 * test support for the *server's* time line — the browser clock is never
 * touched, and the API measures the absence itself (ADR-023).
 */
export async function sendHeroAway(heroName: string, awayMs: number): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query(
      `UPDATE characters
          SET next_combat_at = now() - make_interval(secs => $1::double precision / 1000)
        WHERE name = $2`,
      [awayMs, heroName],
    );
    if (result.rowCount !== 1) {
      throw new Error(`Expected one hero named ${heroName}, updated ${String(result.rowCount)}`);
    }
  } finally {
    await client.end();
  }
}

export interface RecordedOfflineRun {
  readonly fights: number;
  readonly targetStage: string;
  readonly rewardGold: string;
}

/** The offline claims the server recorded for `heroName`. Read-only. */
export async function recordedOfflineRuns(heroName: string): Promise<RecordedOfflineRun[]> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query<{
      fights: number;
      target_stage: string;
      reward_gold_coef: string;
      reward_gold_exp: number;
    }>(
      `SELECT r.fights, r.target_stage::text AS target_stage,
              r.reward_gold_coef::text AS reward_gold_coef, r.reward_gold_exp
         FROM offline_runs r JOIN characters c ON c.id = r.character_id
        WHERE c.name = $1
        ORDER BY r.created_at`,
      [heroName],
    );
    return result.rows.map((row) => ({
      fights: row.fights,
      targetStage: row.target_stage,
      rewardGold: `${row.reward_gold_coef}:${String(row.reward_gold_exp)}`,
    }));
  } finally {
    await client.end();
  }
}
