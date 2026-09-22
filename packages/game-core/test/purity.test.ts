import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Executable form of the Game Core boundary described in CLAUDE.md.
 *
 * ESLint enforces the same rules while editing; this test makes a violation fail
 * CI even if a file is excluded from linting or a rule is disabled inline.
 */

// Vitest runs with the package directory as its working directory.
const packageRoot = process.cwd();
const sourceRoot = join(packageRoot, 'src');

const FORBIDDEN_DEPENDENCIES = [
  'react',
  'react-dom',
  'next',
  '@nestjs/common',
  '@nestjs/core',
  'prisma',
  '@prisma/client',
  '@supabase/supabase-js',
  'ioredis',
  'redis',
  'bullmq',
  'pixi.js',
  'axios',
  'node-fetch',
  'undici',
  '@eternal-forge/config',
  '@eternal-forge/database',
  '@eternal-forge/ui',
];

interface PackageManifest {
  readonly dependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
}

function readManifest(): PackageManifest {
  return JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as PackageManifest;
}

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const absolute = join(directory, entry);
    if (statSync(absolute).isDirectory()) {
      return listSourceFiles(absolute);
    }
    // Tests may import the test runner; the boundary applies to shipped code.
    return absolute.endsWith('.ts') && !absolute.endsWith('.test.ts') ? [absolute] : [];
  });
}

describe('game-core package boundary', () => {
  it('declares no runtime dependency on a framework or infrastructure library', () => {
    const manifest = readManifest();
    const declared = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    ];

    expect(declared.filter((name) => FORBIDDEN_DEPENDENCIES.includes(name))).toEqual([]);
  });

  it('imports nothing outside the package', () => {
    const importPattern = /(?:from\s+|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/gu;

    for (const file of listSourceFiles(sourceRoot)) {
      const contents = readFileSync(file, 'utf8');

      for (const match of contents.matchAll(importPattern)) {
        const specifier = match[1];
        expect(
          specifier?.startsWith('.'),
          `${relative(packageRoot, file)} imports "${specifier ?? ''}"; game-core may only import from itself`,
        ).toBe(true);
      }
    }
  });

  it('never reads ambient randomness, time or globals', () => {
    const forbiddenPatterns: readonly (readonly [RegExp, string])[] = [
      [/Math\s*\.\s*random/u, 'use the deterministic RNG abstraction'],
      [
        /Math\s*\.\s*(?:a?(?:sin|cos|tan)h?|atan2|cbrt|exp|expm1|hypot|log(?:10|1p|2)?|pow)\b/u,
        'engine-approximated Math functions are not deterministic across runtimes',
      ],
      [/Date\s*\.\s*now/u, 'pass time in explicitly'],
      [/new\s+Date\s*\(\s*\)/u, 'pass time in explicitly'],
      [/\bprocess\s*\.\s*env\b/u, 'game-core must not read configuration'],
      [/\bglobalThis\b/u, 'game-core must not touch globals'],
      [/\bwindow\b/u, 'game-core must not touch the browser'],
    ];

    for (const file of listSourceFiles(sourceRoot)) {
      const contents = readFileSync(file, 'utf8');
      const code = contents.replaceAll(/\/\*[\s\S]*?\*\/|\/\/.*$/gmu, '');

      for (const [pattern, reason] of forbiddenPatterns) {
        expect(pattern.test(code), `${relative(packageRoot, file)}: ${reason}`).toBe(false);
      }
    }
  });
});
