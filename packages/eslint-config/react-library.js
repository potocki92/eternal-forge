import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import { baseConfig } from './base.js';

export const reactLibraryConfig = [
  ...baseConfig,
  reactHooks.configs.flat['recommended-latest'],
  {
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
];

export default reactLibraryConfig;
