import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.taxidriver.agenda',
  appName: 'VozRuta',
  webDir: 'www',
  plugins: {
    Keyboard: {
      resize: 'body'
    }
  }
};

export default config;
