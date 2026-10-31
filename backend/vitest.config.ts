import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://tutor:tutor@localhost:5432/tutordb_test',
      JWT_SECRET: 'test-secret',
      JWT_EXPIRES_IN: '1h',
      ENABLE_DEV_LOGIN: 'true',
      GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
      ADMIN_EMAILS: 'admin@test.com',
      OSRM_URL: 'http://127.0.0.1:9',
      APP_TIMEZONE: 'America/Guatemala',
    },
  },
});
