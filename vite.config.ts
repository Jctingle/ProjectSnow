import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: true,
    allowedHosts: ['.app.github.dev'],
  },
});