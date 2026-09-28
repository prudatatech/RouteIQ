import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Starts the mock Supabase server and pins env before app modules load
    setupFiles: ['test/support/setup.ts'],
    // Undo vi.spyOn / vi.stubEnv after every test
    restoreMocks: true,
    unstubEnvs: true,
  },
});
