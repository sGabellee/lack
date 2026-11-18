/**
 * src/main/window-chrome.js
 * Pure window chrome configuration resolver for macOS, Linux, and Windows.
 * Computes BrowserWindow options, traffic lights, and client control state per platform x style.
 */

function windowChromeFor(platform = process.platform, style = 'gnome') {
  const normStyle = (style || '').toLowerCase();
  const effectiveStyle = (normStyle === 'macos' || normStyle === 'mac')
    ? 'macos'
    : (normStyle === 'windows' || normStyle === 'win')
      ? 'windows'
      : 'gnome';

  // 1. macOS (darwin)
  if (platform === 'darwin') {
    if (effectiveStyle === 'macos') {
      return {
        browserWindowOptions: {
          frame: false,
          titleBarStyle: 'hidden',
          trafficLightPosition: { x: 12, y: 12 }
        },
        nativeButtonsVisible: true,
        customControls: {
          visible: false,
          position: 'left',
          style: 'macos'
        }
      };
    }

    // macOS with GNOME or Windows style: hide native buttons and show custom controls on the right
    return {
      browserWindowOptions: {
        frame: false,
        titleBarStyle: 'hidden',
        trafficLightPosition: { x: 12, y: 12 }
      },
      nativeButtonsVisible: false,
      customControls: {
        visible: true,
        position: effectiveStyle === 'gnome' ? 'left' : 'right',
        style: effectiveStyle
      }
    };
  }

  // 2. Windows (win32)
  if (platform === 'win32') {
    if (effectiveStyle === 'windows') {
      return {
        browserWindowOptions: {
          frame: false,
          titleBarStyle: 'hidden',
          titleBarOverlay: {
            color: '#1f1f1f',
            symbolColor: '#e0e0e0',
            height: 34
          }
        },
        nativeButtonsVisible: true,
        customControls: {
          visible: false,
          position: 'right',
          style: 'windows'
        }
      };
    }

    // Windows with custom GNOME or macOS style controls
    return {
      browserWindowOptions: {
        frame: false,
        titleBarStyle: 'hidden'
      },
      nativeButtonsVisible: false,
      customControls: {
        visible: true,
        position: effectiveStyle === 'macos' ? 'left' : 'right',
        style: effectiveStyle
      }
    };
  }

  // 3. Linux & other platforms
  return {
    browserWindowOptions: {
      frame: false,
      titleBarStyle: undefined
    },
    nativeButtonsVisible: false,
    customControls: {
      visible: true,
      position: effectiveStyle === 'macos' ? 'left' : 'right',
      style: effectiveStyle
    }
  };
}

module.exports = {
  windowChromeFor
};
