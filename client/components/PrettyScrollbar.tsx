import { useEffect, ReactNode } from 'react';
import { Platform } from 'react-native';

const STYLE_ID = 'dietdigidose-pretty-scrollbar';

function WebOnlyPrettyScrollbar({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (Platform.OS === 'web') {
      let style = document.getElementById(STYLE_ID);
      if (!style) {
        style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
        ::-webkit-scrollbar {
          width: 4px;
          height: 4px;
        }

        ::-webkit-scrollbar-track {
          background: transparent;
        }

        ::-webkit-scrollbar-thumb {
          background: rgba(0, 0, 0, 0.2);
          border-radius: 2px;
        }
        `;
        document.head.appendChild(style);
      }

      return () => {
        const existingStyle = document.getElementById(STYLE_ID);
        if (existingStyle) {
          existingStyle.remove();
        }
      }
    }
  }, []);

  return <>{children}</>
}

export { WebOnlyPrettyScrollbar }
