import { normalizePlayerName, playerNameProblem } from '@eternal-forge/contracts';

/**
 * A validated, normalised player-visible name.
 *
 * The rule itself is published in `@eternal-forge/contracts`, because clients
 * must apply exactly the same rule to give feedback before submitting. The
 * domain re-checks it so no code path — HTTP or otherwise — can persist an
 * invalid name; PostgreSQL CHECK constraints are the last line (ADR-017).
 */
export class PlayerName {
  private constructor(readonly value: string) {}

  static parse(raw: string): PlayerName {
    const normalised = normalizePlayerName(raw);
    const problem = playerNameProblem(normalised);

    if (problem !== undefined) {
      throw new InvalidPlayerNameError(problem);
    }

    return new PlayerName(normalised);
  }
}

export class InvalidPlayerNameError extends Error {
  constructor(readonly problem: string) {
    super(`Invalid player name: ${problem}`);
    this.name = 'InvalidPlayerNameError';
  }
}
