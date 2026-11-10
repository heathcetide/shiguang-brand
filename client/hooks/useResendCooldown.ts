import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';

/** A display timer only: the server remains authoritative for SMS rate limits. */
export function useResendCooldown() {
  const availableAt = useRef(0);
  const [countdown, setCountdown] = useState(0);
  const remaining = useCallback(() => Math.max(0, Math.ceil((availableAt.current - Date.now()) / 1000)), []);
  const start = useCallback((seconds: number) => {
    availableAt.current = Date.now() + seconds * 1000;
    setCountdown(remaining());
  }, [remaining]);
  const reset = useCallback(() => {
    availableAt.current = 0;
    setCountdown(0);
  }, []);
  const coolingDown = countdown > 0;

  useEffect(() => {
    if (!coolingDown) return;
    const refresh = () => setCountdown(remaining());
    const timer = setInterval(refresh, 1000);
    const subscription = AppState.addEventListener('change', refresh);
    const browserDocument = Platform.OS === 'web' && typeof document !== 'undefined' ? document : undefined;
    browserDocument?.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      subscription.remove();
      browserDocument?.removeEventListener('visibilitychange', refresh);
    };
  }, [coolingDown, remaining]);

  return { countdown, start, reset, isCoolingDown: useCallback(() => remaining() > 0, [remaining]) };
}
