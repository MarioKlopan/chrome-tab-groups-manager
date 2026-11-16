import { getData, setData, updateSavedGroup, withDataLock } from './storage.js';

export async function getAllWindowsState() {
  const [currentWin, allWindows, allGroups, allTabs] = await Promise.all([
    chrome.windows.getCurrent({ populate: false }),
    chrome.windows.getAll({ populate: false, windowTypes: ['normal'] }),
    chrome.tabGroups.query({}),
    chrome.tabs.query({}),
  ]);

  const groupsByWindow = new Map();
  for (const g of allGroups) {
    if (!groupsByWindow.has(g.windowId)) groupsByWindow.set(g.windowId, []);
    groupsByWindow.get(g.windowId).push({
      id: g.id,
      windowId: g.windowId,
      title: g.title || '',
      color: g.color,
      collapsed: g.collapsed,
      tabs: [],
    });
  }

  const groupById = new Map();
  for (const list of groupsByWindow.values()) {
    for (const g of list) {
      groupById.set(g.id, g);
    }
  }

  const ungroupedByWindow = new Map();
  for (const tab of allTabs) {
    const tabInfo = {
      id: tab.id,
      windowId: tab.windowId,
      title: tab.title || tab.url || 'Untitled',
      url: tab.url || '',
      favIconUrl: tab.favIconUrl || '',
      active: tab.active,
      pinned: tab.pinned,
      index: tab.index,
      groupId: tab.groupId,
    };

    if (
      tab.groupId !== undefined &&
      tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE &&
      groupById.has(tab.groupId)
    ) {
      groupById.get(tab.groupId).tabs.push(tabInfo);
    } else {
      if (!ungroupedByWindow.has(tab.windowId)) ungroupedByWindow.set(tab.windowId, []);
      ungroupedByWindow.get(tab.windowId).push(tabInfo);
    }
  }

  const windows = allWindows.map((win) => ({
    id: win.id,
    isCurrent: win.id === currentWin.id,
    focused: win.focused,
    groups: (groupsByWindow.get(win.id) || []).sort((a, b) => {
      const aIdx = a.tabs[0]?.index ?? 0;
      const bIdx = b.tabs[0]?.index ?? 0;
      return aIdx - bIdx;
    }),
    ungroupedTabs: (ungroupedByWindow.get(win.id) || []).sort((a, b) => a.index - b.index),
  }));

  windows.sort((a, b) => (a.isCurrent === b.isCurrent ? 0 : a.isCurrent ? -1 : 1));
  return { currentWindowId: currentWin.id, windows };
}

export async function reconcileLiveLinks() {
  const [allGroups, allTabs] = await Promise.all([
    chrome.tabGroups.query({}),
    chrome.tabs.query({}),
  ]);
  const liveGroupMap = new Map(allGroups.map((g) => [g.id, g]));
  const tabsByGroup = new Map();
  for (const t of allTabs) {
    if (t.groupId !== undefined && t.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
      if (!tabsByGroup.has(t.groupId)) tabsByGroup.set(t.groupId, []);
      tabsByGroup.get(t.groupId).push({
        url: t.url || '',
        title: t.title || t.url || 'Untitled',
        favIconUrl: t.favIconUrl || '',
      });
    }
  }

  return withDataLock(async () => {
    const data = await getData();
    let changed = false;

    for (const saved of data.savedGroups) {
      if (saved.liveGroupId === null || saved.liveGroupId === undefined) continue;
      const live = liveGroupMap.get(saved.liveGroupId);
      if (!live) {
        saved.liveGroupId = null;
        saved.liveWindowId = null;
        changed = true;
      } else {
        const liveTabs = tabsByGroup.get(live.id) || [];
        saved.title = live.title || '';
        saved.color = live.color;
        saved.collapsed = live.collapsed;
        saved.liveWindowId = live.windowId;
        if (liveTabs.length > 0) {
          saved.tabs = liveTabs;
        }
        changed = true;
      }
    }

    if (changed) {
      await setData(data);
    }
    return data;
  });
}

export async function assignTabToGroup(tabId, targetGroupId, targetWindowId) {
  const tab = await chrome.tabs.get(tabId);
  if (tab.windowId !== targetWindowId) {
    await chrome.tabs.move(tabId, { windowId: targetWindowId, index: -1 });
  }
  await chrome.tabs.group({ tabIds: [tabId], groupId: targetGroupId });
}

export async function ungroupTab(tabId) {
  await chrome.tabs.ungroup(tabId);
}

export async function createGroupFromTab(tabId, { title = '', color = 'blue', windowId }) {
  const groupId = await chrome.tabs.group({
    tabIds: [tabId],
    createProperties: { windowId },
  });
  await chrome.tabGroups.update(groupId, { title, color });
  return groupId;
}

export async function mergeChromeGroups(sourceGroupId, targetGroupId) {
  if (sourceGroupId === targetGroupId) return;
  const [sourceTabs, targetGroup] = await Promise.all([
    chrome.tabs.query({ groupId: sourceGroupId }),
    chrome.tabGroups.get(targetGroupId),
  ]);
  if (sourceTabs.length === 0) return;

  const tabIds = sourceTabs.map((t) => t.id);
  const needsMove = sourceTabs.some((t) => t.windowId !== targetGroup.windowId);
  if (needsMove) {
    await chrome.tabs.move(tabIds, { windowId: targetGroup.windowId, index: -1 });
  }
  await chrome.tabs.group({ tabIds, groupId: targetGroupId });
}

export async function updateChromeGroup(groupId, { title, color, collapsed }) {
  const updateProps = {};
  if (title !== undefined) updateProps.title = title;
  if (color !== undefined) updateProps.color = color;
  if (collapsed !== undefined) updateProps.collapsed = collapsed;
  return chrome.tabGroups.update(groupId, updateProps);
}

export async function closeChromeGroup(groupId) {
  const tabs = await chrome.tabs.query({ groupId });
  const tabIds = tabs.map((t) => t.id);
  if (tabIds.length > 0) {
    await chrome.tabs.remove(tabIds);
  }
}

export async function focusChromeGroup(groupId, windowId) {
  const group = await chrome.tabGroups.get(groupId);
  const targetWindowId = windowId ?? group.windowId;
  if (group.collapsed) {
    await chrome.tabGroups.update(groupId, { collapsed: false });
  }
  const tabs = await chrome.tabs.query({ groupId });
  if (tabs.length > 0) {
    await chrome.tabs.update(tabs[0].id, { active: true });
  }
  await chrome.windows.update(targetWindowId, { focused: true });
}

export async function focusChromeTab(tabId, windowId) {
  await chrome.tabs.update(tabId, { active: true });
  await chrome.windows.update(windowId, { focused: true });
}

export async function closeChromeTab(tabId) {
  await chrome.tabs.remove(tabId);
}

export async function openSavedGroupInChrome(savedGroup, { inNewWindow = false } = {}) {
  // If already live in Chrome, focus it instead of duplicating
  if (savedGroup.liveGroupId !== null && savedGroup.liveGroupId !== undefined) {
    try {
      const existing = await chrome.tabGroups.get(savedGroup.liveGroupId);
      if (existing) {
        await focusChromeGroup(existing.id, existing.windowId);
        return existing.id;
      }
    } catch {
      // Group no longer exists; proceed to reopen
    }
  }

  let targetWindowId;
  let initialBlankTabId = null;

  if (inNewWindow) {
    const newWin = await chrome.windows.create({ focused: true });
    targetWindowId = newWin.id;
    const winTabs = await chrome.tabs.query({ windowId: targetWindowId });
    if (winTabs.length === 1 && (!winTabs[0].url || winTabs[0].url === 'chrome://newtab/')) {
      initialBlankTabId = winTabs[0].id;
    }
  } else {
    const currentWin = await chrome.windows.getCurrent({ populate: false });
    targetWindowId = currentWin.id;
  }

  const createdTabIds = [];
  const tabsToOpen = savedGroup.tabs?.length ? savedGroup.tabs : [{ url: 'chrome://newtab/' }];

  for (const t of tabsToOpen) {
    try {
      const created = await chrome.tabs.create({
        windowId: targetWindowId,
        url: t.url || 'chrome://newtab/',
        active: false,
      });
      createdTabIds.push(created.id);
    } catch {
      // Skip restricted or malformed URLs
    }
  }

  if (createdTabIds.length === 0) {
    const fallback = await chrome.tabs.create({
      windowId: targetWindowId,
      url: 'chrome://newtab/',
      active: true,
    });
    createdTabIds.push(fallback.id);
  }

  const newGroupId = await chrome.tabs.group({
    tabIds: createdTabIds,
    createProperties: { windowId: targetWindowId },
  });

  await chrome.tabGroups.update(newGroupId, {
    title: savedGroup.title || '',
    color: savedGroup.color || 'grey',
    collapsed: false,
  });

  await updateSavedGroup(savedGroup.id, {
    liveGroupId: newGroupId,
    liveWindowId: targetWindowId,
  });

  if (initialBlankTabId) {
    try {
      await chrome.tabs.remove(initialBlankTabId);
    } catch {
      // Ignore if already closed
    }
  }

  if (inNewWindow && createdTabIds.length > 0) {
    await chrome.tabs.update(createdTabIds[0], { active: true });
  }

  return newGroupId;
}
