import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const page = (name) => fileURLToPath(new URL(`./${name}.html`, import.meta.url));

export default defineConfig({
    build: {
        rollupOptions: {
            input: { main: page('index'), privacy: page('privacy') }
        }
    }
});
