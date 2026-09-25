import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

// Start conservatively so an enabled Reduce Motion setting never sees a brief animated frame.
export function useReduceMotion() {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => { if (mounted) setReduced(enabled); }).catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => { mounted = false; subscription.remove(); };
  }, []);
  return reduced;
}
