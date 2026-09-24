import { GameCoreError } from '../errors.js';

const DEFINITION_ID_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u;
const INSTANCE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export const ITEM_DEFINITION_ID_MAX_LENGTH = 64;

/** Stable, human-reviewable static-content identity. */
export class ItemDefinitionId {
  private constructor(private readonly value: string) {
    Object.freeze(this);
  }

  public static parse(value: string): ItemDefinitionId {
    if (value.length > ITEM_DEFINITION_ID_MAX_LENGTH || !DEFINITION_ID_PATTERN.test(value)) {
      throw new GameCoreError(
        'INVALID_FORMAT',
        'Item definition ID must be 1–64 lowercase letters, digits or single underscores, starting with a letter.',
      );
    }
    return new ItemDefinitionId(value);
  }

  public equals(other: ItemDefinitionId): boolean {
    return this.value === other.value;
  }

  public toString(): string {
    return this.value;
  }

  public toJSON(): string {
    return this.value;
  }
}

/**
 * Globally unique owned-item identity in canonical UUID form.
 * Generation intentionally belongs to an outer, server-side boundary.
 */
export class ItemInstanceId {
  private constructor(private readonly value: string) {
    Object.freeze(this);
  }

  public static parse(value: string): ItemInstanceId {
    if (!INSTANCE_ID_PATTERN.test(value)) {
      throw new GameCoreError(
        'INVALID_FORMAT',
        'Item instance ID must be a canonical lowercase UUID with a valid version and variant.',
      );
    }
    return new ItemInstanceId(value);
  }

  public equals(other: ItemInstanceId): boolean {
    return this.value === other.value;
  }

  public toString(): string {
    return this.value;
  }

  public toJSON(): string {
    return this.value;
  }
}
