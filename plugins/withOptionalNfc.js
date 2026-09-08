const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withOptionalNfc(config) {
  return withAndroidManifest(config, (next) => {
    const manifest = next.modResults.manifest;
    const features = manifest['uses-feature'] || [];
    const nfc = features.find((feature) => feature.$?.['android:name'] === 'android.hardware.nfc');
    if (nfc) {
      nfc.$['android:required'] = 'false';
    } else {
      features.push({ $: { 'android:name': 'android.hardware.nfc', 'android:required': 'false' } });
    }
    manifest['uses-feature'] = features;
    return next;
  });
};
