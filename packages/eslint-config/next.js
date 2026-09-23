import nextPlugin from '@next/eslint-plugin-next';
import { reactLibraryConfig } from './react-library.js';

export const nextConfig = [
  ...reactLibraryConfig,
  {
    plugins: { '@next/next': nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
  },
  {
    files: ['src/**/*.tsx', 'src/**/*.ts'],
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          // ADR-013: the web app may use the pure HugeNumber value type to parse
          // and format server values. Every gameplay rule stays on the server
          // (ADR-003), so nothing else from Game Core is importable here.
          paths: [
            {
              name: '@eternal-forge/game-core',
              allowImportNames: ['HugeNumber'],
              message:
                'The web app may import only HugeNumber from Game Core; gameplay is server-authoritative (ADR-003, ADR-013).',
            },
          ],
          patterns: [
            {
              group: ['@eternal-forge/database', '@eternal-forge/database/*', '@prisma/*'],
              message: 'The web app talks to the API, never to persistence directly.',
            },
          ],
        },
      ],
    },
  },
];

export default nextConfig;
