import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Button } from '../ui';
import { colors, fonts } from '../theme';
import { machineLinkFromUrl } from './api';

type ScannedLink = { publicId: string; exerciseSlug?: string };

// Fallback for phones without NFC: the QR code on each machine carries the same URL as its NFC sticker.
export function QrScanner({ visible, onClose, onScanned, codeEntry }: {
  visible: boolean; onClose: () => void; onScanned: (link: ScannedLink) => void; codeEntry: ReactNode;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const [message, setMessage] = useState('');
  const [showCode, setShowCode] = useState(false);
  const handled = useRef(false);

  useEffect(() => {
    if (!visible) return;
    handled.current = false; setMessage(''); setShowCode(false);
    if (permission && !permission.granted && permission.canAskAgain) void requestPermission();
  }, [visible, permission?.granted]);

  const scanned = ({ data }: { data: string }) => {
    if (handled.current) return;
    handled.current = true;
    const link = machineLinkFromUrl(data);
    if (!link) {
      setMessage('That QR code is not a StrictlyVision station.');
      setTimeout(() => { handled.current = false; }, 1800);
      return;
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    onScanned(link);
  };

  const denied = permission && !permission.granted && !permission.canAskAgain;

  return <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
    {/* A modal is its own native window, so it needs its own provider to get the notch and home indicator insets. */}
    <SafeAreaProvider><View style={styles.root}>
      {permission?.granted && !showCode ? <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={scanned} /> : null}
      <SafeAreaView style={styles.overlay} edges={['top', 'bottom']}>
        <View style={styles.top}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close scanner" hitSlop={8} onPress={onClose} style={({ pressed }) => [styles.close, pressed && { opacity: 0.7 }]}><Ionicons name="close" size={26} color={colors.text} /></Pressable>
        </View>

        {showCode ? <View style={styles.codePanel}>
          <Text style={styles.title}>Enter the station code</Text>
          <Text style={styles.body}>It’s printed on the label next to the QR code.</Text>
          {codeEntry}
        </View> : <View style={styles.center}>
          <Text style={styles.title}>Scan the machine’s QR code</Text>
          <View style={styles.frame} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <View style={[styles.corner, styles.tl]} /><View style={[styles.corner, styles.tr]} />
            <View style={[styles.corner, styles.bl]} /><View style={[styles.corner, styles.br]} />
            {!permission?.granted ? <Ionicons name="qr-code-outline" size={64} color={colors.dim} /> : null}
          </View>
          {denied ? <View style={styles.permission}>
            <Text style={styles.body}>Camera access is off for StrictlyVision. Turn it on in Settings to scan QR codes.</Text>
            <Button label="Open Settings" tone="secondary" onPress={() => void Linking.openSettings()} />
          </View> : <Text style={styles.body}>{message || 'Line the code up inside the frame. It opens as soon as it’s read.'}</Text>}
        </View>}

        <Pressable accessibilityRole="button" onPress={() => setShowCode((value) => !value)} style={styles.switch}>
          <Ionicons name={showCode ? 'qr-code-outline' : 'keypad-outline'} size={18} color={colors.lime} />
          <Text style={styles.switchText}>{showCode ? 'Scan the QR code instead' : 'Enter the station code instead'}</Text>
        </Pressable>
      </SafeAreaView>
    </View></SafeAreaProvider>
  </Modal>;
}

const FRAME = 248;
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  overlay: { flex: 1, paddingHorizontal: 20, justifyContent: 'space-between' },
  top: { flexDirection: 'row', justifyContent: 'flex-start', paddingTop: 8 },
  close: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.panelRaised, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  center: { alignItems: 'center', gap: 22 },
  codePanel: { gap: 12 },
  title: { color: colors.text, fontFamily: fonts.bold, fontSize: 24, letterSpacing: -0.5, textAlign: 'center' },
  body: { color: colors.muted, fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, textAlign: 'center', maxWidth: 300, alignSelf: 'center' },
  frame: { width: FRAME, height: FRAME, alignItems: 'center', justifyContent: 'center' },
  corner: { position: 'absolute', width: 42, height: 42, borderColor: colors.lime },
  tl: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 18 },
  tr: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 18 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 18 },
  br: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 18 },
  permission: { gap: 14, alignItems: 'stretch', alignSelf: 'stretch' },
  switch: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 999, backgroundColor: 'rgba(8,9,10,0.72)', borderWidth: 1, borderColor: colors.border, marginBottom: 8 },
  switchText: { color: colors.lime, fontFamily: fonts.semibold, fontSize: 15 }
});
