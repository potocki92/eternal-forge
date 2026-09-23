/**
 * Headless stage simulation from the command line.
 *
 *   pnpm --filter @eternal-forge/game-core run simulate -- --level 5 --seed demo
 *
 * Options: --level (default 1), --seed (default "demo"), --start (default 1),
 * --max (default 1000). Output is plain text for humans. The authoritative
 * result is the `StageRunResult` returned by `simulateStages`, and this script
 * only formats it.
 *
 * Lives outside `src/` so it ships in no build and may use `process`.
 */
import {
  GAME_RULES_VERSION,
  StageNumber,
  createCharacter,
  getGameRules,
  simulateStages,
  type StageRunEntry,
} from '../src/index.js';

interface Options {
  readonly level: number;
  readonly seed: string;
  readonly start: StageNumber;
  readonly max: number;
}

function parseOptions(argv: readonly string[]): Options {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag?.startsWith('--') === true && value !== undefined) {
      values.set(flag.slice(2), value);
      index += 1;
    }
  }
  return {
    level: Number(values.get('level') ?? '1'),
    seed: values.get('seed') ?? 'demo',
    start: StageNumber.parse(values.get('start') ?? '1'),
    max: Number(values.get('max') ?? '1000'),
  };
}

function formatEntry(entry: StageRunEntry): string {
  const stage = `Stage ${entry.stage.number.toString().padStart(4)}`;
  const kind = entry.stage.kind === 'BOSS' ? 'boss ' : '     ';
  const seconds = `${(entry.durationMs / 1000).toFixed(2).padStart(6)} s`;
  if (entry.outcome === 'LOSS') {
    return `${stage} ${kind}— LOSS (${entry.endReason}, ${entry.enemyArchetypeId}, ${seconds})`;
  }
  const { gold, experience } = entry.rewards;
  return `${stage} ${kind}— WIN  (${entry.enemyArchetypeId}, ${seconds}, +${gold.toString()} gold, +${experience.toString()} xp)`;
}

// pnpm forwards the `--` separator itself; it is not an option.
const options = parseOptions(process.argv.slice(2).filter((argument) => argument !== '--'));
const rules = getGameRules(GAME_RULES_VERSION);
const result = simulateStages({
  character: createCharacter(options.level, rules),
  seed: options.seed,
  rulesVersion: GAME_RULES_VERSION,
  startStage: options.start,
  maxStages: options.max,
});

const lines = [
  `Eternal Forge — headless stage simulation (rules v${result.rulesVersion}, seed "${result.seed}", character level ${options.level})`,
  '',
  ...result.stages.map(formatEntry),
  '',
  `Highest stage cleared: ${result.highestStageCleared?.toString() ?? 'none'}`,
  `Stopped by: ${result.stopReason}`,
  `Total rewards: ${result.totalRewards.gold.toString()} gold, ${result.totalRewards.experience.toString()} xp`,
];
process.stdout.write(`${lines.join('\n')}\n`);
