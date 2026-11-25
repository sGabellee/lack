/**
 * Builds a toast notification controller backed by a document-like DOM API.
 * Supports singleton/keyed notifications via `options.replaceKey` so rapid
 * repeated updates (e.g. UI zoom shortcuts) replace the existing toast instead
 * of stacking duplicate messages.
 *
 * @param {object} params
 * @param {Document} params.doc - DOM document instance
 * @param {(s: string) => string} [params.escapeHtml] - HTML escaping helper
 */
function createNotificationController({ doc, escapeHtml } = {}) {
  const esc = typeof escapeHtml === 'function'
    ? escapeHtml
    : (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[m]));

  const keyedEntries = new Map();

  function getOrCreateContainer() {
    let container = doc.getElementById('notification-container');
    if (!container) {
      container = doc.createElement('div');
      container.id = 'notification-container';
      doc.body.appendChild(container);
    }
    return container;
  }

  function showNotification(message, type = 'info', options = {}) {
    const { replaceKey = null, duration = 4000 } = options || {};
    const container = getOrCreateContainer();
    const safeType = type || 'info';
    const textStr = message == null ? '' : String(message);

    if (replaceKey && keyedEntries.has(replaceKey)) {
      const existing = keyedEntries.get(replaceKey);
      const inDom = Boolean(existing.element && existing.element.parentNode === container);
      if (inDom && !existing.isDismissed()) {
        existing.update(textStr, safeType, duration);
        return existing.element;
      }
      // Immediately clear dismissing or stale entry so only one notification ever exists
      existing.forceRemove();
    }

    const notification = doc.createElement('div');
    notification.className = `cloud-notification ${safeType}`;
    if (replaceKey) {
      notification.setAttribute('data-notif-key', replaceKey);
    }
    notification.innerHTML = `<span class="cloud-notification-text">${esc(textStr)}</span>`;
    container.appendChild(notification);

    let dismissTimer = null;
    let removeTimer = null;
    let dismissed = false;
    let hovered = false;

    function dismiss() {
      if (dismissed) return;
      dismissed = true;
      clearTimeout(dismissTimer);
      notification.classList.remove('cloud-no-enter');
      notification.classList.add('cloud-dismiss');
      removeTimer = setTimeout(() => {
        if (replaceKey && keyedEntries.get(replaceKey) === entry) {
          keyedEntries.delete(replaceKey);
        }
        try { notification.remove(); } catch {}
      }, 320);
    }

    const entry = {
      element: notification,
      isDismissed: () => dismissed,
      forceRemove() {
        dismissed = true;
        clearTimeout(dismissTimer);
        clearTimeout(removeTimer);
        if (replaceKey && keyedEntries.get(replaceKey) === entry) {
          keyedEntries.delete(replaceKey);
        }
        try { notification.remove(); } catch {}
      },
      update(nextMsg, nextType, nextDuration) {
        const textEl = notification.querySelector('.cloud-notification-text');
        if (textEl) {
          textEl.textContent = nextMsg;
        } else {
          notification.innerHTML = `<span class="cloud-notification-text">${esc(nextMsg)}</span>`;
        }
        notification.className = `cloud-notification ${nextType} cloud-no-enter`;
        if (container.lastElementChild && container.lastElementChild !== notification) {
          container.appendChild(notification);
        }
        clearTimeout(dismissTimer);
        if (!hovered) {
          dismissTimer = setTimeout(dismiss, nextDuration);
        }
      }
    };

    dismissTimer = setTimeout(dismiss, duration);
    notification.addEventListener('click', (e) => {
      e.stopPropagation();
      dismiss();
    });
    notification.addEventListener('mouseenter', () => {
      hovered = true;
      clearTimeout(dismissTimer);
    });
    notification.addEventListener('mouseleave', () => {
      hovered = false;
      if (!dismissed) {
        dismissTimer = setTimeout(dismiss, 2500);
      }
    });

    if (replaceKey) {
      keyedEntries.set(replaceKey, entry);
    }

    return notification;
  }

  return {
    getOrCreateContainer,
    showNotification,
    _getKeyedCount: () => keyedEntries.size
  };
}

module.exports = {
  createNotificationController
};
