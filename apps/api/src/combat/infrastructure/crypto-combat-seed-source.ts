import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { CombatSeedSource } from '../application/ports/combat-seed-source.port.js';

/** Bits of entropy per seed: far beyond any search a client could run. */
const SEED_BYTES = 32;

/**
 * 256 bits from the operating system's CSPRNG, base64url-encoded: 43
 * characters. Game Core hashes the string into its simulation generator
 * (ADR-015). Unpredictability comes from this source, not from that hash.
 */
@Injectable()
export class CryptoCombatSeedSource implements CombatSeedSource {
  next(): string {
    return randomBytes(SEED_BYTES).toString('base64url');
  }
}
