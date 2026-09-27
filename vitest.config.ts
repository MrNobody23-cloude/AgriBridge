import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['test/auth.test.ts', 'test/*.test.{ts,tsx}'],
        exclude: ['test/*.test.js', 'test/standalone.test.ts', 'test/AgriBridgeTraceability.test.js', 'test/setup.ts'],
        setupFiles: ['test/setup.ts'],
        globals: true,
        environment: 'node',
    },
    resolve: {
        alias: {
            '@': '/src',
        },
    },
});
