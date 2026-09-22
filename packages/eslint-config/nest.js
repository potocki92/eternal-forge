import { baseConfig } from './base.js';

export const nestConfig = [
  ...baseConfig,
  {
    rules: {
      // NestJS relies on decorators whose metadata typescript-eslint cannot model.
      '@typescript-eslint/no-extraneous-class': 'off',
      '@typescript-eslint/parameter-properties': 'off',
    },
  },
  {
    files: ['**/*.controller.ts'],
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@prisma/*', '@eternal-forge/database', '@eternal-forge/database/*'],
              message:
                'Controllers must stay thin: go through an application use case, never persistence.',
            },
          ],
        },
      ],
    },
  },
];

export default nestConfig;
