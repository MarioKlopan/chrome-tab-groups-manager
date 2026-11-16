import { getData, setData, withDataLock } from '../shared/storage.js';
import {
  focusChromeGroup,
  focusChromeTab,
  openSavedGroupInChrome,
  reconcileLiveLinks,
} from '../shared/chrome-api.js';

async function syncGroupTabs(groupId) {
  if (groupId === undefined || groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) return;

  const data = await getData();
  const linked = data.savedGroups.find((g) => g.liveGroupId === groupId);
  if (!linked) return;

  const tabs = await chrome.tabs.query({ groupId });
  // Never overwrite saved tabs with an empty array (happens when group is closing)
  if (tabs.length === 0) return;

  const mappedTabs = tabs
    .sort((a, b) => a.index - b.index)
    .map((t) => ({
      url: t.url || '',
      title: t.title || t.url || 'Untitled',
      favIconUrl: t.favIconUrl || '',
    }));

  await withDataLock(async () => {
    const latest = await getData();
    const target = latest.savedGroups.find((g) => g.id === linked.id);
    if (!target || target.liveGroupId !== groupId) return;
    target.tabs = mappedTabs;
    target.updatedAt = Date.now();
    await setData(latest);
  });
}

async function syncAllLinkedGroups() {
  const data = await getData();
  const liveIds = data.savedGroups
    .map((g) => g.liveGroupId)
    .filter((id) => id !== null && id !== undefined);
  for (const gid of liveIds) {
    await syncGroupTabs(gid);
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await reconcileLiveLinks();
});

chrome.runtime.onStartup.addListener(async () => {
  await reconcileLiveLinks();
});

chrome.tabGroups.onUpdated.addListener(async (group) => {
  await withDataLock(async () => {
    const data = await getData();
    const target = data.savedGroups.find((g) => g.liveGroupId === group.id);
    if (!target) return;
    target.title = group.title || '';
    target.color = group.color;
    target.collapsed = group.collapsed;
    target.liveWindowId = group.windowId;
    target.updatedAt = Date.now();
    await setData(data);
  });
});

chrome.tabGroups.onRemoved.addListener(async (group) => {
  await withDataLock(async () => {
    const data = await getData();
    const target = data.savedGroups.find((g) => g.liveGroupId === group.id);
    if (!target) return;
    target.liveGroupId = null;
    target.liveWindowId = null;
    await setData(data);
  });
});

chrome.tabs.onCreated.addListener(async (tab) => {
  if (tab.groupId !== undefined && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
    await syncGroupTabs(tab.groupId);
  }
});

chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
  if (
    changeInfo.url === undefined &&
    changeInfo.title === undefined &&
    changeInfo.favIconUrl === undefined &&
    changeInfo.groupId === undefined
  ) {
    return;
  }
  if (tab.groupId !== undefined && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
    await syncGroupTabs(tab.groupId);
  } else if (changeInfo.groupId !== undefined) {
    // A tab left a group; re-sync all linked groups so the previous group updates
    await syncAllLinkedGroups();
  }
});

chrome.tabs.onMoved.addListener(async (_tabId, moveInfo) => {
  const tabs = await chrome.tabs.query({ windowId: moveInfo.windowId });
  const movedTab = tabs.find((t) => t.index === moveInfo.toIndex);
  if (movedTab && movedTab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
    await syncGroupTabs(movedTab.groupId);
  }
});

chrome.tabs.onAttached.addListener(async (tabId) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
      await syncGroupTabs(tab.groupId);
    }
  } catch {
    // Ignore if tab closed
  }
});

chrome.tabs.onDetached.addListener(async () => {
  await syncAllLinkedGroups();
});

chrome.tabs.onRemoved.addListener(async (_tabId, removeInfo) => {
  if (removeInfo.isWindowClosing) return;
  await syncAllLinkedGroups();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
      if (message?.type === 'OPEN_SAVED_GROUP') {
        const groupId = await openSavedGroupInChrome(message.savedGroup, message.options);
        sendResponse({ ok: true, groupId });
        return;
      }
      if (message?.type === 'FOCUS_GROUP') {
        await focusChromeGroup(message.groupId, message.windowId);
        sendResponse({ ok: true });
        return;
      }
      if (message?.type === 'FOCUS_TAB') {
        await focusChromeTab(message.tabId, message.windowId);
        sendResponse({ ok: true });
        return;
      }
      sendResponse({ ok: false, error: 'Unknown message type' });
    } catch (err) {
      sendResponse({ ok: false, error: err?.message || String(err) });
    }
  })();
  return true;
});
