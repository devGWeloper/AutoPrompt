import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        nodeLlm: '#3b82f6',
        nodeTool: '#10b981',
        nodeRouter: '#f59e0b',
        nodeStart: '#6b7280',
        nodeEnd: '#1f2937',
      },
    },
  },
  plugins: [],
};

export default config;
