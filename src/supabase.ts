import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = 'https://owedpojalgtkiuthptft.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_7FLJBomC7TcEGCbTMPPn8Q_U0aj_zVG';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false
  }
});
