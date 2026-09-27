import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import QRCode from 'react-native-qrcode-svg';
import type { Session } from '@supabase/supabase-js';
import { assignTag } from './api';
import { verifyUrlOnTag, writeUrlToTag } from './nfc';
import { colors, fonts } from './theme';
import type { Machine, MachineTag } from './types';
import { Button, Notice } from './ui';

// One place to program a station, reachable from any machine at any time. The NFC sticker and the QR code
// carry the same link, so a station can have either or both and members land on the same page.
export function StationTags({ session, gymId, machine, visible, onClose, onChanged }: {
  session: Session; gymId: string; machine: Machine | null; visible: boolean; onClose: () => void; onChanged: () => void;
}) {
  const [mode, setMode] = useState<'nfc' | 'qr'>('nfc');
  const [tag, setTag] = useState<MachineTag | null>(null);
  const [nfcStage, setNfcStage] = useState<'write' | 'verify' | 'done'>('write');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const qrRef = useRef<{ toDataURL: (callback: (data: string) => void) => void } | null>(null);

  useEffect(() => {
    if (!visible || !machine) return;
    setMode('nfc'); setNfcStage('write'); setMessage('');
    setTag(machine.tags.find((item) => item.status === 'active') || machine.tags.find((item) => item.status === 'unassigned') || null);
  }, [visible, machine?.id]);

  if (!machine) return null;
  const url = tag ? `https://strictlyinc.com/t/${tag.publicId}` : '';

  // A station without a link gets one the first time the owner programs anything.
  const ensureTag = async (): Promise<MachineTag> => {
    if (tag) return tag;
    const slug = `${machine.name}-${machine.stationCode}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'machine';
    const next: MachineTag = {
      publicId: `${slug}-${Math.random().toString(36).slice(2, 7)}`,
      labelCode: `${machine.stationCode}-${machine.name.replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase()}`,
      type: 'ntag215', status: 'unassigned'
    };
    await assignTag(session, gymId, machine.id, next);
    setTag(next);
    return next;
  };
  const activate = async (current: MachineTag) => {
    if (current.status === 'active') return current;
    const active = { ...current, status: 'active' as const };
    await assignTag(session, gymId, machine.id, active);
    setTag(active); onChanged();
    return active;
  };

  const write = async () => {
    setBusy(true); setMessage('Hold the top of your phone against the sticker.');
    try {
      const current = await ensureTag();
      await writeUrlToTag(`https://strictlyinc.com/t/${current.publicId}`);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      setNfcStage('verify'); setMessage('Written. Tap the same sticker once more to verify it.');
    } catch (reason) { setMessage(nfcMessage(reason)); }
    setBusy(false);
  };
  const verify = async () => {
    setBusy(true); setMessage('Hold the same sticker near your phone.');
    try {
      const current = await ensureTag();
      await verifyUrlOnTag(`https://strictlyinc.com/t/${current.publicId}`);
      await activate(current);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      setNfcStage('done'); setMessage('');
    } catch (reason) { setMessage(nfcMessage(reason)); }
    setBusy(false);
  };

  const showQr = async () => {
    setMode('qr'); setMessage('');
    if (tag) return;
    setBusy(true);
    try { await ensureTag(); } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'The QR code could not be created.'); }
    setBusy(false);
  };
  // Saving or printing means the code is going on the machine, so that is when it goes live for members.
  const shareQr = async () => {
    if (!tag || !qrRef.current) return;
    setBusy(true); setMessage('');
    try {
      await activate(tag);
      const png = await new Promise<string>((resolve) => qrRef.current?.toDataURL(resolve));
      await Share.share({ url: `data:image/png;base64,${png}`, title: `${machine.name} · Station ${machine.stationCode}` });
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'The QR code could not be shared.'); }
    setBusy(false);
  };

  return <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
    <SafeAreaProvider><SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.screen}>
        <View style={styles.top}>
          <View style={styles.flex}>
            <Text style={styles.station}>Station {machine.stationCode}</Text>
            <Text style={styles.title}>{machine.name}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={8} onPress={onClose} style={({ pressed }) => [styles.close, pressed && styles.pressed]}><Ionicons name="close" size={26} color={colors.text} /></Pressable>
        </View>

        <View style={styles.segments} accessibilityRole="tablist">
          {(['nfc', 'qr'] as const).map((item) => {
            const selected = mode === item;
            return <Pressable key={item} accessibilityRole="tab" accessibilityState={{ selected }} onPress={() => item === 'qr' ? showQr() : (setMode('nfc'), setMessage(''))} style={[styles.segment, selected && styles.segmentOn]}>
              <Ionicons name={item === 'nfc' ? 'radio-outline' : 'qr-code-outline'} size={18} color={selected ? colors.onLime : colors.muted} />
              <Text style={[styles.segmentText, selected && styles.segmentTextOn]}>{item === 'nfc' ? 'NFC sticker' : 'QR code'}</Text>
            </Pressable>;
          })}
        </View>

        <View style={styles.status}>
          <Ionicons name={tag?.status === 'active' ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={tag?.status === 'active' ? colors.lime : colors.muted} />
          <Text style={styles.statusText}>{tag?.status === 'active' ? 'Live: members can open this station' : 'Not live yet: program a sticker or save the QR code'}</Text>
        </View>

        {mode === 'nfc' ? <View style={styles.panel}>
          {nfcStage === 'done' ? <>
            <View style={styles.doneCircle}><Ionicons name="checkmark" size={40} color={colors.onLime} /></View>
            <Text style={styles.panelTitle}>Sticker verified</Text>
            <Text style={styles.copy}>Place it where members can tap before their set. Program another sticker for the same station any time.</Text>
            <Button label="Program another sticker" tone="secondary" onPress={() => { setNfcStage('write'); setMessage(''); }} />
          </> : <>
            <View style={styles.rings}><Ionicons name="phone-portrait-outline" size={36} color={colors.lime} /></View>
            <Text style={styles.panelTitle}>{nfcStage === 'write' ? 'Write the sticker' : 'Verify the sticker'}</Text>
            <Text style={styles.copy}>{nfcStage === 'write'
              ? 'Hold the top of your phone against the center of an NTAG215 sticker until your phone confirms.'
              : 'Tap the same sticker again. It goes live once it opens this station correctly.'}</Text>
            {message ? <Notice tone={/written/i.test(message) ? 'success' : 'normal'}>{message}</Notice> : null}
            <Button label={nfcStage === 'write' ? 'Write NFC sticker' : 'Verify and go live'} onPress={nfcStage === 'write' ? write : verify} loading={busy} />
            {nfcStage === 'verify' ? <Button label="Write again" tone="secondary" onPress={() => setNfcStage('write')} disabled={busy} /> : null}
          </>}
        </View> : <View style={styles.panel}>
          {tag ? <>
            <View style={styles.qrCard} accessibilityLabel={`QR code for ${machine.name}, station ${machine.stationCode}`}>
              <QRCode value={url} size={220} color="#08090A" backgroundColor="#FFFFFF" ecl="M" quietZone={14} getRef={(ref) => { qrRef.current = ref; }} />
              <Text style={styles.qrLabel}>Station {machine.stationCode}</Text>
              <Text style={styles.qrName} numberOfLines={2}>{machine.name}</Text>
            </View>
            <Text style={styles.copy}>Print it at least 2 inches wide and stick it next to the NFC sticker. It opens the same station page.</Text>
            {message ? <Notice tone="danger">{message}</Notice> : null}
            <Button label="Save or print QR code" onPress={shareQr} loading={busy} />
          </> : busy ? <ActivityIndicator color={colors.lime} /> : message ? <Notice tone="danger">{message}</Notice> : null}
        </View>}

        {url ? <Text style={styles.url} selectable>{url}</Text> : null}
      </ScrollView>
    </SafeAreaView></SafeAreaProvider>
  </Modal>;
}

function nfcMessage(reason: unknown) {
  const raw = reason instanceof Error ? reason.message : 'The sticker could not be read.';
  if (/cancel|invalidate/i.test(raw)) return 'Scan canceled. Tap the button to try again.';
  if (/does not have NFC/i.test(raw)) return 'This device has no NFC. Use the QR code tab instead.';
  if (/NDEF|tech|tag/i.test(raw)) return `${raw} Make sure it is an unlocked, NDEF-compatible NTAG215 sticker.`;
  return raw;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg }, flex: { flex: 1 },
  screen: { width: '100%', maxWidth: 560, alignSelf: 'center', padding: 20, paddingBottom: 40, gap: 18 },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  station: { color: colors.lime, fontFamily: fonts.semibold, fontSize: 14 },
  title: { color: colors.text, fontFamily: fonts.bold, fontSize: 30, letterSpacing: -0.8, lineHeight: 34, marginTop: 2 },
  close: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.panelRaised, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.7 },
  segments: { flexDirection: 'row', padding: 4, gap: 4, borderRadius: 16, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border },
  segment: { flex: 1, minHeight: 46, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  segmentOn: { backgroundColor: colors.lime },
  segmentText: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 15 }, segmentTextOn: { color: colors.onLime },
  status: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusText: { color: colors.muted, fontFamily: fonts.medium, fontSize: 14, flex: 1 },
  panel: { borderRadius: 20, padding: 20, gap: 16, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border, alignItems: 'stretch' },
  rings: { alignSelf: 'center', width: 96, height: 96, borderRadius: 48, borderWidth: 1.5, borderColor: colors.lime, alignItems: 'center', justifyContent: 'center' },
  doneCircle: { alignSelf: 'center', width: 80, height: 80, borderRadius: 40, backgroundColor: colors.lime, alignItems: 'center', justifyContent: 'center' },
  panelTitle: { color: colors.text, fontFamily: fonts.bold, fontSize: 22, textAlign: 'center' },
  copy: { color: colors.muted, fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  qrCard: { alignSelf: 'center', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 18, paddingTop: 10, paddingBottom: 16, paddingHorizontal: 10, width: 260 },
  qrLabel: { color: '#08090A', fontFamily: fonts.bold, fontSize: 20, marginTop: 4 },
  qrName: { color: '#3A3F3D', fontFamily: fonts.medium, fontSize: 14, textAlign: 'center', marginTop: 2 },
  url: { color: colors.dim, fontFamily: fonts.regular, fontSize: 12, textAlign: 'center' }
});
