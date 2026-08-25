/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SITES_BYPASS_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
