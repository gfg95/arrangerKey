import { sveltekit } from '@sveltejs/kit/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'vite';

// Web MIDI exige un contexte sécurisé (HTTPS ou localhost).
// `npm run dev:phone` active un certificat auto-signé pour tester depuis
// le téléphone via le réseau local.
export default defineConfig({
  plugins: [sveltekit(), ...(process.env.HTTPS ? [basicSsl()] : [])]
});
