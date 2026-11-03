import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'vite';

// `npm run dev:lan` / `npm run serve:lan` use mode "lan": serve over HTTPS on
// the home network so other devices can use the microphone (browsers only
// allow it on https:// or localhost).
export default defineConfig(({ mode }) => {
  const lan = mode === 'lan';
  return {
    plugins: lan ? [basicSsl({ name: 'reading-buddy' })] : [],
    server: { host: lan },
    preview: { host: lan },
  };
});
