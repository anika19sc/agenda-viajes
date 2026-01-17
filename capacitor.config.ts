import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.taxidriver.agenda',
  appName: 'VozRuta',
  webDir: 'www',
  plugins: {
    Keyboard: {
      resize: 'body'
    },
    CapacitorSQLite: {
      androidIsEncryption: false,
      androidBiometric: {
        biometricAuth: false,
        biometricTitle: "Biometric login for capacitor sqlite",
        biometricSubTitle: "Log in using your biometric"
      }
    }
  }
};

export default config;
