// ====== LACK COLLABORATION MODULE (Yjs + WebRTC + CodeMirror 6) ======
const Y = require('yjs');
const { WebrtcProvider } = require('y-webrtc');
const i18n = require('./i18n.js');

let ydoc = null;
let provider = null;
let yText = null;
let undoManager = null;
let currentRoomId = null;
let localCmRef = null;
let localEditorRef = null;
let inputHandlerRef = null;
let isApplyingRemote = false;

// Calculates minimal diff between old and new text (fallback for textarea)
function applyDiffToYText(yTextTarget, oldVal, newVal) {
  let commonStart = 0;
  while (
    commonStart < oldVal.length &&
    commonStart < newVal.length &&
    oldVal[commonStart] === newVal[commonStart]
  ) {
    commonStart++;
  }

  let commonEnd = 0;
  while (
    commonEnd < oldVal.length - commonStart &&
    commonEnd < newVal.length - commonStart &&
    oldVal[oldVal.length - 1 - commonEnd] === newVal[newVal.length - 1 - commonEnd]
  ) {
    commonEnd++;
  }

  const deleteCount = oldVal.length - commonStart - commonEnd;
  const insertText = newVal.slice(commonStart, newVal.length - commonEnd);

  if (deleteCount > 0) {
    yTextTarget.delete(commonStart, deleteCount);
  }
  if (insertText.length > 0) {
    yTextTarget.insert(commonStart, insertText);
  }
}

/**
 * Starts or joins a collaborative session
 */
function startCollaboration({
  roomId,
  password = null,
  cm = null,
  editor = null,
  isJoining = false,
  onRemoteUpdate,
  onUsersChange,
  onStatusChange,
  showNotification
}) {
  if (provider) {
    leaveCollaboration();
  }

  currentRoomId = roomId.trim();
  localCmRef = cm;
  localEditorRef = editor;

  ydoc = new Y.Doc();
  yText = ydoc.getText('latex-content');
  undoManager = new Y.UndoManager(yText);

  // If creator, initialize shared document with local editor text
  const initialContent = cm ? cm.getValue() : (editor ? editor.value : '');
  if (!isJoining && initialContent && initialContent.trim().length > 0) {
    ydoc.transact(() => {
      if (yText.length === 0) {
        yText.insert(0, initialContent);
      }
    }, 'local');
  }

  // Reliable public WebRTC signaling and STUN servers for peer-to-peer connection
  const providerOpts = {
    signaling: [
      'wss://y-webrtc.fly.dev',
      'wss://y-webrtc-signaling.fly.dev',
      'wss://signaling.fly.dev'
    ],
    peerOpts: {
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' }
        ]
      }
    }
  };

  if (password && password.trim().length > 0) {
    providerOpts.password = password.trim();
  }

  try {
    provider = new WebrtcProvider(currentRoomId, ydoc, providerOpts);
  } catch (err) {
    console.error('Failed to create WebRTC provider:', err);
    if (showNotification) {
      showNotification('Error starting collaboration: ' + err.message, 'error');
    }
    return false;
  }

  // Bind to CodeMirror 6
  if (cm && typeof cm.bindYjs === 'function') {
    cm.bindYjs(yText, undoManager, provider.awareness);
  } else if (editor) {
    // Fallback textarea binding
    yText.observe((event, transaction) => {
      if (transaction.origin === 'local') return;

      isApplyingRemote = true;
      const remoteStr = yText.toString();

      const selStart = editor.selectionStart;
      const selEnd = editor.selectionEnd;
      const oldLen = editor.value.length;

      editor.value = remoteStr;

      const diff = remoteStr.length - oldLen;
      const newSel = Math.max(0, Math.min(remoteStr.length, selStart + (selStart > 0 ? diff : 0)));
      editor.selectionStart = newSel;
      editor.selectionEnd = newSel;

      isApplyingRemote = false;

      if (onRemoteUpdate) {
        onRemoteUpdate(remoteStr);
      }
    });

    inputHandlerRef = () => {
      if (isApplyingRemote) return;
      if (!yText || !ydoc) return;

      ydoc.transact(() => {
        const currentDoc = yText.toString();
        const currentVal = editor.value;
        if (currentDoc !== currentVal) {
          applyDiffToYText(yText, currentDoc, currentVal);
        }
      }, 'local');
    };

    editor.addEventListener('input', inputHandlerRef);
  }

  // Awareness (User count)
  provider.awareness.on('change', () => {
    const states = provider.awareness.getStates();
    const count = Math.max(1, states.size);
    if (onUsersChange) {
      onUsersChange(count);
    }
  });

  // Connection status
  provider.on('status', (event) => {
    if (onStatusChange) {
      onStatusChange(event.status); // 'connected' or 'connecting' or 'disconnected'
    }
  });

  provider.on('synced', (event) => {
    if (event.synced && isJoining) {
      const syncedText = yText.toString();
      if (syncedText.length > 0) {
        if (cm) {
          cm.setValue(syncedText);
        } else if (editor) {
          isApplyingRemote = true;
          editor.value = syncedText;
          isApplyingRemote = false;
        }
        if (onRemoteUpdate) onRemoteUpdate(syncedText);
      }
    }
  });

  // Set user awareness state
  provider.awareness.setLocalStateField('user', {
    name: 'Peer-' + Math.floor(1000 + Math.random() * 9000),
    color: '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0')
  });

  return true;
}

/**
 * Leaves active collaboration session
 */
function leaveCollaboration() {
  if (localCmRef && typeof localCmRef.unbindYjs === 'function') {
    localCmRef.unbindYjs();
    localCmRef = null;
  }

  if (localEditorRef && inputHandlerRef) {
    localEditorRef.removeEventListener('input', inputHandlerRef);
    inputHandlerRef = null;
  }

  if (provider) {
    try {
      provider.disconnect();
      provider.destroy();
    } catch (e) {
      console.warn('Error disconnecting provider:', e);
    }
    provider = null;
  }

  if (ydoc) {
    try {
      ydoc.destroy();
    } catch (e) {}
    ydoc = null;
  }

  yText = null;
  undoManager = null;
  currentRoomId = null;
  localEditorRef = null;
  isApplyingRemote = false;
}

function generateRoomId() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let rand = '';
  for (let i = 0; i < 6; i++) {
    rand += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `lack-${rand}`;
}

function getCollabState() {
  return {
    isActive: !!provider,
    roomId: currentRoomId,
    connectedUsers: provider ? Math.max(1, provider.awareness.getStates().size) : 0
  };
}

module.exports = {
  startCollaboration,
  leaveCollaboration,
  generateRoomId,
  getCollabState
};
