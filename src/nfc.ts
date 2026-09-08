import { Platform } from 'react-native';
import NfcManager, { Ndef, NfcTech } from 'react-native-nfc-manager';

let started = false;

export async function ensureNfc() {
  if (!started) {
    await NfcManager.start();
    started = true;
  }
  const supported = await NfcManager.isSupported();
  if (!supported) throw new Error('This phone does not support NFC tag writing.');
  if (Platform.OS === 'android' && !(await NfcManager.isEnabled())) throw new Error('Turn on NFC in Android settings, then try again.');
}

export async function writeUrlToTag(url: string) {
  await ensureNfc();
  const bytes = Ndef.encodeMessage([Ndef.uriRecord(url)]);
  if (!bytes) throw new Error('Strictly could not prepare this tag URL.');
  try {
    await NfcManager.requestTechnology(NfcTech.Ndef, { alertMessage: 'Hold your phone near the Strictly NFC sticker.' });
    await NfcManager.ndefHandler.writeNdefMessage(bytes);
    if (Platform.OS === 'ios') await NfcManager.setAlertMessageIOS('Tag programmed. Keep it nearby for verification.');
  } catch (error) {
    await NfcManager.cancelTechnologyRequest().catch(() => undefined);
    if (Platform.OS !== 'android') throw error;
    // Some factory-new tags have not been NDEF formatted. Android exposes a
    // safe one-step formatter, so owners can still program them in this flow.
    try {
      await NfcManager.requestTechnology(NfcTech.NdefFormatable, { alertMessage: 'Keep holding the blank sticker in place.' });
      await NfcManager.ndefFormatableHandlerAndroid.formatNdef(bytes, { readOnly: false });
    } catch {
      throw error;
    }
  } finally {
    await NfcManager.cancelTechnologyRequest().catch(() => undefined);
  }
}

function decodeUrl(tag: any) {
  const record = tag?.ndefMessage?.[0];
  if (!record?.payload) return null;
  try { return Ndef.uri.decodePayload(record.payload); } catch { return null; }
}

export async function verifyUrlOnTag(expectedUrl: string) {
  await ensureNfc();
  try {
    await NfcManager.requestTechnology(NfcTech.Ndef, { alertMessage: 'Hold the same sticker near your phone to verify it.' });
    const tag = await NfcManager.getTag();
    const actualUrl = decodeUrl(tag);
    if (actualUrl !== expectedUrl) throw new Error(actualUrl ? `This tag contains a different URL: ${actualUrl}` : 'No Strictly URL was found on this tag.');
    if (Platform.OS === 'ios') await NfcManager.setAlertMessageIOS('Verified. This tag is ready for the gym floor.');
    return true;
  } finally {
    await NfcManager.cancelTechnologyRequest().catch(() => undefined);
  }
}
