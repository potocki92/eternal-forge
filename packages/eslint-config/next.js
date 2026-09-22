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
