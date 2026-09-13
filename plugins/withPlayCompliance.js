const fs = require('fs');
const path = require('path');
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');

// Google Play compliance for the Android build:
// 1. Health Connect's permission sheet links to the app's privacy policy through
//    ACTION_SHOW_PERMISSIONS_RATIONALE (Android 13 and lower) and the ViewPermissionUsageActivity alias
//    (Android 14+). react-native-health-connect points both at MainActivity, which only opens the app,
//    so route them to an activity that actually shows the policy.
// 2. expo-location always declares a location foreground service. StrictlyVision never tracks location in
//    the background, and an unused FGS type triggers Play's foreground service declaration.

const PRIVACY_URL = 'https://strictlyinc.com/privacy';
const RATIONALE_ACTION = 'androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE';
const RATIONALE_ACTIVITY = '.HealthPermissionsRationaleActivity';
const LOCATION_SERVICE = 'expo.modules.location.services.LocationTaskService';

const activitySource = (pkg) => `package ${pkg}

import android.annotation.SuppressLint
import android.app.Activity
import android.os.Bundle
import android.webkit.WebView
import android.webkit.WebViewClient

// Shown when a person taps the privacy policy link on the Health Connect permission screen.
class HealthPermissionsRationaleActivity : Activity() {
  @SuppressLint("SetJavaScriptEnabled")
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val webView = WebView(this)
    webView.settings.javaScriptEnabled = true
    webView.webViewClient = WebViewClient()
    setContentView(webView)
    webView.loadUrl("${PRIVACY_URL}")
  }
}
`;

function withRationaleActivitySource(config) {
  return withDangerousMod(config, ['android', async (next) => {
    const pkg = next.android?.package;
    if (!pkg) throw new Error('withPlayCompliance: android.package is required');
    const dir = path.join(next.modRequest.platformProjectRoot, 'app', 'src', 'main', 'java', ...pkg.split('.'));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'HealthPermissionsRationaleActivity.kt'), activitySource(pkg));
    return next;
  }]);
}

function withComplianceManifest(config) {
  return withAndroidManifest(config, (next) => {
    const manifest = next.modResults.manifest;
    manifest.$['xmlns:tools'] = manifest.$['xmlns:tools'] || 'http://schemas.android.com/tools';
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(next.modResults);
    const mainActivity = AndroidConfig.Manifest.getMainActivityOrThrow(next.modResults);

    // Move the Health Connect rationale intent off MainActivity.
    mainActivity['intent-filter'] = (mainActivity['intent-filter'] || []).filter(
      (filter) => !(filter.action || []).some((action) => action.$['android:name'] === RATIONALE_ACTION)
    );

    application.activity = (application.activity || []).filter((activity) => activity.$['android:name'] !== RATIONALE_ACTIVITY);
    application.activity.push({
      $: { 'android:name': RATIONALE_ACTIVITY, 'android:exported': 'true', 'android:label': '@string/app_name' },
      'intent-filter': [{ action: [{ $: { 'android:name': RATIONALE_ACTION } }] }],
    });

    // Android 14+: the permission usage alias must target the same privacy policy screen.
    for (const alias of application['activity-alias'] || []) {
      if (alias.$['android:name'] === 'ViewPermissionUsageActivity' || alias.$['android:name']?.endsWith('.ViewPermissionUsageActivity')) {
        alias.$['android:targetActivity'] = RATIONALE_ACTIVITY;
      }
    }

    // Drop expo-location's background location foreground service.
    application.service = (application.service || []).filter((service) => service.$['android:name'] !== LOCATION_SERVICE);
    application.service.push({ $: { 'android:name': LOCATION_SERVICE, 'tools:node': 'remove' } });

    return next;
  });
}

module.exports = function withPlayCompliance(config) {
  return withComplianceManifest(withRationaleActivitySource(config));
};
