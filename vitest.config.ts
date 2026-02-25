import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            '@/components': path.resolve(__dirname, './src/components'),
            '@/lib': path.resolve(__dirname, './src/lib'),
            '@/hooks': path.resolve(__dirname, './src/hooks'),
            '@/types': path.resolve(__dirname, './src/types'),
            '@/store': path.resolve(__dirname, './src/store'),
            '@/utils': path.resolve(__dirname, './src/utils'),
            '@/services': path.resolve(__dirname, './src/services'),
            '@/contexts': path.resolve(__dirname, './src/contexts'),
        },
    },
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: ['./src/__tests__/setup.ts'],
        include: ['src/**/*.{test,spec}.{ts,tsx}'],
        css: false,
    },
});
