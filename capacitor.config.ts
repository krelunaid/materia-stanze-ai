import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.andreagadducci.materia',
  appName: 'Materia',
  webDir: 'dist',
  server: {
    url: 'https://materia-stanze-ai.andreagadducci.chatgpt.site',
    cleartext: false,
  },
  ios: {
    backgroundColor: '#f4f6f2',
    contentInset: 'always',
    preferredContentMode: 'mobile',
  },
};

export default config;
