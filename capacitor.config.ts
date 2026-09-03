import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.andreagadducci.materia',
  appName: 'Materia',
  webDir: 'dist-native',
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
  },
  ios: {
    backgroundColor: '#f4f6f2',
    contentInset: 'never',
    preferredContentMode: 'mobile',
  },
};

export default config;
