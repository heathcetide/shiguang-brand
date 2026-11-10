import { AuthProvider } from '@/contexts/AuthContext';
import { type ReactNode } from 'react';
import { View } from 'react-native';
import { WebOnlyPrettyScrollbar } from './PrettyScrollbar'
import { NotificationLifecycle } from './NotificationLifecycle';
import { ShareLinkLifecycle } from './ShareLinkLifecycle';
import { ServerStateProvider } from './ServerStateProvider';
import { AppUpdateProvider } from './AppUpdateProvider';

function Provider({ children }: { children: ReactNode }) {
  return <WebOnlyPrettyScrollbar>
      <ServerStateProvider>
        <AuthProvider>
          <AppUpdateProvider>
          <View style={{ flex: 1 }}>
            <NotificationLifecycle />
            <ShareLinkLifecycle />
            {children}
          </View>
          </AppUpdateProvider>
        </AuthProvider>
      </ServerStateProvider>
    </WebOnlyPrettyScrollbar>
}

export {
  Provider,
}
