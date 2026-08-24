import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.andreagadducci.materia',
  appName: 'Materia',
  webDir: 'dist-native',
  ios: {
    backgroundColor: '#f4f6f2',
    contentInset: 'always',
    preferredContentMode: 'mobile',
  },
};

export default config;
