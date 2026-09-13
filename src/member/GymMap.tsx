import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import MapView, { Marker, type Region } from 'react-native-maps';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { colors, fonts, radius } from '../theme';
import type { PartnerGym } from './types';

export type Coords = { latitude: number; longitude: number };

// Google Maps on Android crashes the app without an API key (app.json android.config.googleMaps.apiKey).
// iOS uses Apple Maps and needs no key.
const mapsAvailable = Platform.OS !== 'android' || !!Constants.expoConfig?.android?.config?.googleMaps?.apiKey;

const MILES_PER_KM = 0.621371;
export function distanceMiles(a: Coords, b: Coords) {
  const toRad = (deg: number) => deg * Math.PI / 180;
  const dLat = toRad(b.latitude - a.latitude), dLon = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)) * MILES_PER_KM;
}
export const formatMiles = (miles: number) => miles < 0.1 ? 'Here' : `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi`;

function regionFor(points: Coords[]): Region {
  const lats = points.map((p) => p.latitude), lons = points.map((p) => p.longitude);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLon = Math.min(...lons), maxLon = Math.max(...lons);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLon + maxLon) / 2,
    latitudeDelta: Math.max(0.06, (maxLat - minLat) * 1.6),
    longitudeDelta: Math.max(0.06, (maxLon - minLon) * 1.6)
  };
}

export function GymMap({ gyms, userLocation, onUserLocation, onSelectGym }: {
  gyms: PartnerGym[]; userLocation: Coords | null; onUserLocation: (coords: Coords) => void; onSelectGym?: (gym: PartnerGym) => void;
}) {
  const map = useRef<MapView>(null);
  const [locating, setLocating] = useState(false);
  const [denied, setDenied] = useState(false);

  const nearest = userLocation && gyms.length
    ? gyms.map((gym) => ({ gym, miles: distanceMiles(userLocation, gym) })).sort((a, b) => a.miles - b.miles)[0]
    : null;

  useEffect(() => {
    if (!userLocation || !nearest) return;
    map.current?.animateToRegion(regionFor([userLocation, nearest.gym]), 450);
  }, [userLocation?.latitude, userLocation?.longitude, nearest?.gym.id]);

  const locate = async () => {
    setLocating(true); setDenied(false);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') { setDenied(true); return; }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      onUserLocation({ latitude: position.coords.latitude, longitude: position.coords.longitude });
    } catch { setDenied(true); }
    finally { setLocating(false); }
  };

  return (
    <View>
      <View style={[styles.frame, !mapsAvailable && styles.frameCompact]}>
        {mapsAvailable ? <MapView
          ref={map}
          style={StyleSheet.absoluteFill}
          initialRegion={regionFor(gyms.length ? gyms : [{ latitude: 47.6062, longitude: -122.3321 }])}
          userInterfaceStyle="dark"
          showsUserLocation={!!userLocation}
          showsPointsOfInterests={false}
          toolbarEnabled={false}
        >
          {gyms.map((gym) => (
            <Marker key={gym.id} coordinate={{ latitude: gym.latitude, longitude: gym.longitude }} title={gym.name} description={`${gym.address} · ${gym.city}`} onCalloutPress={() => onSelectGym?.(gym)}>
              <View style={[styles.pin, { backgroundColor: gym.accentColor, borderColor: gym.backgroundColor }]}><Ionicons name="barbell" size={16} color={gym.backgroundColor} /></View>
            </Marker>
          ))}
        </MapView> : (
          <View style={styles.noMap}>
            <Ionicons name="location-outline" size={22} color={colors.lime} />
            <Text style={styles.noMapTitle}>Find your nearest gym</Text>
            <Text style={styles.noMapCopy}>Share your location to sort partner gyms by distance.</Text>
          </View>
        )}
        <Pressable accessibilityRole="button" accessibilityLabel="Use my location" onPress={locate} disabled={locating} style={({ pressed }) => [styles.locate, pressed && styles.pressed]}>
          {locating ? <ActivityIndicator color={colors.onLime} /> : <Ionicons name="navigate" size={16} color={colors.onLime} />}
          <Text style={styles.locateText}>{userLocation ? 'Update location' : 'Use my location'}</Text>
        </Pressable>
      </View>
      {nearest ? (
        <Pressable onPress={() => onSelectGym?.(nearest.gym)} style={styles.nearest}>
          <View style={styles.flex}><Text style={styles.nearestLabel}>NEAREST GYM</Text><Text style={styles.nearestName}>{nearest.gym.name}</Text></View>
          <Text style={styles.nearestMiles}>{formatMiles(nearest.miles)}</Text>
        </Pressable>
      ) : denied ? (
        <Pressable onPress={() => Linking.openSettings()} style={styles.nearest}>
          <View style={styles.flex}><Text style={styles.nearestLabel}>LOCATION IS OFF</Text><Text style={styles.deniedCopy}>Allow location in Settings to find the gym closest to you.</Text></View>
          <Ionicons name="chevron-forward" size={18} color={colors.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frameCompact: { height: 184 },
  noMap: { padding: 18, gap: 6 },
  noMapTitle: { color: colors.text, fontFamily: fonts.semibold, fontSize: 17, marginTop: 4 },
  noMapCopy: { color: colors.muted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, maxWidth: 230 },
  frame: { height: 300,borderRadius: radius.md, overflow: 'hidden', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  pin: { width: 34, height: 34, borderRadius: 17, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  locate: { position: 'absolute', right: 12, bottom: 12, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, borderRadius: radius.pill, backgroundColor: colors.lime },
  locateText: { color: colors.onLime, fontFamily: fonts.semibold, fontSize: 14 },
  pressed: { transform: [{ scale: .975 }] },
  nearest: { marginTop: 12, minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  flex: { flex: 1 },
  nearestLabel: { color: colors.dim, fontFamily: fonts.semibold, fontSize: 10, letterSpacing: 1.1 },
  nearestName: { color: colors.text, fontFamily: fonts.semibold, fontSize: 16, marginTop: 2 },
  nearestMiles: { color: colors.lime, fontFamily: fonts.bold, fontSize: 22, letterSpacing: -0.5 },
  deniedCopy: { color: colors.muted, fontFamily: fonts.regular, fontSize: 13, marginTop: 2 }
});
