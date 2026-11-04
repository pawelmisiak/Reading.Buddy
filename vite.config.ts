import basicSsl from '@vitejs/plugin-basic-ssl';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { storiesApi } from './server/storiesApi.ts';

// Saved stories live in this file on the computer running the app.
// Override with READING_BUDDY_DATA=/some/folder.
const dataDir = process.env.READING_BUDDY_DATA ?? fileURLToPath(new URL('./data', import.meta.url));

// `npm run dev:lan` / `npm run serve:lan` use mode "lan": serve over HTTPS on
// the home network so other devices can use the microphone (browsers only
// allow it on https:// or localhost).
export default defineConfig(({ mode }) => {
  const lan = mode === 'lan';
  return {
    plugins: [storiesApi(`${dataDir}/stories.json`), ...(lan ? [basicSsl({ name: 'reading-buddy' })] : [])],
    server: { host: lan, watch: { ignored: ['**/data/**'] } },
    preview: { host: lan },
  };
});
