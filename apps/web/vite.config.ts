import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
export default defineConfig(({mode})=>{
  const env={...loadEnv(mode,root,''),...process.env};
  return {
    envDir:root,
    resolve:{alias:{obsidian:fileURLToPath(new URL('./src/host/obsidian.ts',import.meta.url))}},
    server:{host:env.WEB_HOST||env.HOST||'127.0.0.1',port:Number(env.WEB_PORT||5173),strictPort:true,
      allowedHosts:['.e2b.app',...(env.LUBI_DEV_HOSTS||'').split(',').filter(Boolean)],
      proxy:{'/api':{target:env.LUBI_API_ORIGIN||`http://127.0.0.1:${env.PORT||3000}`,changeOrigin:false}}},
    build:{target:'es2022',chunkSizeWarningLimit:1600},
  };
});
