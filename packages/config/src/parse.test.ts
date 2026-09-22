import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { EnvValidationError } from './env-error.js';
import { memoize, parseEnv } from './parse.js';

const schema = z.object({
  TOKEN: z.string().min(4),
  COUNT: z.string().optional(),
});

describe('parseEnv', () => {
  it('returns the parsed value when the source is valid', () => {
    expect(parseEnv('test', schema, { TOKEN: 'abcdef' })).toEqual({ TOKEN: 'abcdef' });
  });

  it('throws EnvValidationError naming every failing variable', () => {
    const wide = z.object({ A: z.string(), B: z.string() });

    expect(() => parseEnv('test', wide, {})).toThrow(EnvValidationError);

    try {
      parseEnv('test', wide, {});
      expect.unreachable('parseEnv should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const issues = (error as EnvValidationError).issues;
      expect(issues.map((issue) => issue.variable)).toEqual(['A', 'B']);
    }
  });

  it('never includes the offending value in the error message', () => {
    const secretValue = 'super-secret-service-role-key';

    try {
      parseEnv('test', z.object({ TOKEN: z.string().min(1000) }), { TOKEN: secretValue });
      expect.unreachable('parseEnv should have thrown');
    } catch (error) {
      expect((error as Error).message).not.toContain(secretValue);
      expect((error as Error).message).toContain('TOKEN');
    }
  });
});

describe('memoize', () => {
  it('evaluates the factory once', () => {
    let calls = 0;
    const load = memoize(() => {
      calls += 1;
      return calls;
    });

    expect(load()).toBe(1);
    expect(load()).toBe(1);
    expect(calls).toBe(1);
  });
});
