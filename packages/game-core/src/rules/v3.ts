import type { GameRules } from './game-rules.js';
import { RULES_V2 } from './v2.js';

/** V3 activates caller-supplied resolved player snapshots; balance is unchanged. */
export const RULES_V3: GameRules = { ...RULES_V2, version: 3 };
