// Layers local secrets onto app.json so they stay out of the public repo.
// GOOGLE_MAPS_ANDROID_API_KEY comes from .env locally and from an EAS environment variable in cloud builds.
// The key ships inside the Android app regardless; its Google Cloud restrictions (package + SHA-1, Maps SDK only) protect it.
module.exports = ({ config }) => {
  const apiKey = process.env.GOOGLE_MAPS_ANDROID_API_KEY;
  if (!apiKey) return config;
  return {
    ...config,
    android: {
      ...config.android,
      config: { ...config.android?.config, googleMaps: { apiKey } }
    },
    // Expo strips android.config from the runtime manifest, so expose only a flag the app can read.
    extra: { ...config.extra, googleMapsAndroidConfigured: true }
  };
};
