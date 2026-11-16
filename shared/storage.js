export const STORAGE_KEY = 'tgm_data';

export const CHROME_GROUP_COLORS = [
  'grey',
  'blue',
  'red',
  'yellow',
  'green',
  'pink',
  'purple',
  'cyan',
  'orange',
];

const DEFAULT_DATA = {
  folders: [],
  savedGroups: [],
  settings: {
    theme: 'dark', // 'dark' | 'light' | 'system'
  },
};

export function generateId(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

let writeQueue = Promise.resolve();

export function withDataLock(fn) {
  const next = writeQueue.then(() => fn(), () => fn());
  writeQueue = next.catch(() => {});
  return next;
}

export async function getData() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const raw = result[STORAGE_KEY];
  if (!raw || typeof raw !== 'object') {
    return structuredClone(DEFAULT_DATA);
  }
  return {
    folders: Array.isArray(raw.folders) ? raw.folders : [],
    savedGroups: Array.isArray(raw.savedGroups) ? raw.savedGroups : [],
    settings: {
      theme: raw.settings?.theme || 'dark',
    },
  };
}

export async function setData(data) {
  await chrome.storage.local.set({ [STORAGE_KEY]: data });
  return data;
}

export function isDescendantFolder(folders, targetId, potentialAncestorId) {
  if (!targetId || !potentialAncestorId) return false;
  if (targetId === potentialAncestorId) return true;
  const map = new Map(folders.map((f) => [f.id, f]));
  let current = map.get(targetId);
  const visited = new Set();
  while (current && current.parentId) {
    if (visited.has(current.id)) break;
    visited.add(current.id);
    if (current.parentId === potentialAncestorId) return true;
    current = map.get(current.parentId);
  }
  return false;
}

export function getFolderPath(folders, folderId) {
  if (!folderId) return 'Unfiled';
  const map = new Map(folders.map((f) => [f.id, f]));
  const parts = [];
  let current = map.get(folderId);
  const visited = new Set();
  while (current) {
    if (visited.has(current.id)) break;
    visited.add(current.id);
    parts.unshift(current.name);
    current = current.parentId ? map.get(current.parentId) : null;
  }
  return parts.length > 0 ? parts.join(' / ') : 'Unfiled';
}

export async function createFolder(name, parentId = null) {
  return withDataLock(async () => {
    const data = await getData();
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Folder name cannot be empty.');
    const siblings = data.folders.filter((f) => (f.parentId ?? null) === (parentId ?? null));
    const folder = {
      id: generateId('fld'),
      name: trimmed,
      parentId: parentId ?? null,
      collapsed: false,
      order: siblings.length,
      createdAt: Date.now(),
    };
    data.folders.push(folder);
    await setData(data);
    return folder;
  });
}

export async function renameFolder(folderId, name) {
  return withDataLock(async () => {
    const data = await getData();
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Folder name cannot be empty.');
    const folder = data.folders.find((f) => f.id === folderId);
    if (!folder) return null;
    folder.name = trimmed;
    await setData(data);
    return folder;
  });
}

export async function toggleFolderCollapsed(folderId, collapsed) {
  return withDataLock(async () => {
    const data = await getData();
    const folder = data.folders.find((f) => f.id === folderId);
    if (!folder) return null;
    folder.collapsed = Boolean(collapsed);
    await setData(data);
    return folder;
  });
}

export async function moveFolder(folderId, newParentId = null) {
  return withDataLock(async () => {
    const data = await getData();
    const folder = data.folders.find((f) => f.id === folderId);
    if (!folder) return null;
    const targetParent = newParentId ?? null;
    if (targetParent === folderId || isDescendantFolder(data.folders, targetParent, folderId)) {
      throw new Error('Cannot move a folder into itself or its subfolder.');
    }
    folder.parentId = targetParent;
    await setData(data);
    return folder;
  });
}

export async function deleteFolder(folderId, { deleteGroups = false } = {}) {
  return withDataLock(async () => {
    const data = await getData();
    const toRemove = new Set([folderId]);
    let added = true;
    while (added) {
      added = false;
      for (const f of data.folders) {
        if (f.parentId && toRemove.has(f.parentId) && !toRemove.has(f.id)) {
          toRemove.add(f.id);
          added = true;
        }
      }
    }
    data.folders = data.folders.filter((f) => !toRemove.has(f.id));
    if (deleteGroups) {
      data.savedGroups = data.savedGroups.filter((g) => !toRemove.has(g.folderId));
    } else {
      for (const g of data.savedGroups) {
        if (toRemove.has(g.folderId)) {
          g.folderId = null;
        }
      }
    }
    await setData(data);
    return data;
  });
}

export async function saveGroupToLibrary({
  title = '',
  color = 'grey',
  collapsed = false,
  tabs = [],
  folderId = null,
  liveGroupId = null,
  liveWindowId = null,
}) {
  return withDataLock(async () => {
    const data = await getData();
    if (liveGroupId !== null) {
      const existing = data.savedGroups.find((g) => g.liveGroupId === liveGroupId);
      if (existing) {
        existing.title = title;
        existing.color = color;
        existing.collapsed = collapsed;
        existing.tabs = tabs;
        existing.folderId = folderId ?? existing.folderId;
        existing.liveWindowId = liveWindowId;
        existing.updatedAt = Date.now();
        await setData(data);
        return existing;
      }
    }

    const siblings = data.savedGroups.filter((g) => (g.folderId ?? null) === (folderId ?? null));
    const saved = {
      id: generateId('grp'),
      folderId: folderId ?? null,
      title,
      color: CHROME_GROUP_COLORS.includes(color) ? color : 'grey',
      collapsed: Boolean(collapsed),
      liveGroupId,
      liveWindowId,
      tabs: tabs.map((t) => ({
        url: t.url || '',
        title: t.title || t.url || 'Untitled',
        favIconUrl: t.favIconUrl || '',
      })),
      order: siblings.length,
      updatedAt: Date.now(),
    };
    data.savedGroups.push(saved);
    await setData(data);
    return saved;
  });
}

export async function updateSavedGroup(groupId, patch) {
  return withDataLock(async () => {
    const data = await getData();
    const group = data.savedGroups.find((g) => g.id === groupId);
    if (!group) return null;
    Object.assign(group, patch, { updatedAt: Date.now() });
    await setData(data);
    return group;
  });
}

export async function moveSavedGroup(groupId, folderId = null) {
  return updateSavedGroup(groupId, { folderId: folderId ?? null });
}

export async function deleteSavedGroup(groupId) {
  return withDataLock(async () => {
    const data = await getData();
    data.savedGroups = data.savedGroups.filter((g) => g.id !== groupId);
    await setData(data);
    return data;
  });
}

export async function removeTabFromSavedGroup(groupId, tabIndex) {
  return withDataLock(async () => {
    const data = await getData();
    const group = data.savedGroups.find((g) => g.id === groupId);
    if (!group) return null;
    group.tabs = group.tabs.filter((_, idx) => idx !== tabIndex);
    group.updatedAt = Date.now();
    await setData(data);
    return group;
  });
}

export async function setThemeSetting(theme) {
  return withDataLock(async () => {
    const data = await getData();
    data.settings.theme = theme;
    await setData(data);
    return data.settings;
  });
}

export async function exportLibraryJson() {
  const data = await getData();
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    folders: data.folders,
    savedGroups: data.savedGroups.map((g) => ({
      ...g,
      liveGroupId: null,
      liveWindowId: null,
    })),
  };
}

export async function importLibraryJson(payload, mode = 'merge') {
  if (!payload || !Array.isArray(payload.folders) || !Array.isArray(payload.savedGroups)) {
    throw new Error('Invalid backup file format.');
  }
  return withDataLock(async () => {
    const data = await getData();
    if (mode === 'replace') {
      data.folders = [];
      data.savedGroups = [];
    }

    const folderIdMap = new Map();
    for (const f of payload.folders) {
      if (!f || typeof f.name !== 'string') continue;
      const newId = generateId('fld');
      folderIdMap.set(f.id, newId);
    }

    for (const f of payload.folders) {
      if (!f || typeof f.name !== 'string') continue;
      const newId = folderIdMap.get(f.id);
      if (!newId) continue;
      data.folders.push({
        id: newId,
        name: f.name.trim() || 'Imported Folder',
        parentId: f.parentId ? (folderIdMap.get(f.parentId) ?? null) : null,
        collapsed: Boolean(f.collapsed),
        order: typeof f.order === 'number' ? f.order : data.folders.length,
        createdAt: f.createdAt || Date.now(),
      });
    }

    for (const g of payload.savedGroups) {
      if (!g || !Array.isArray(g.tabs)) continue;
      data.savedGroups.push({
        id: generateId('grp'),
        folderId: g.folderId ? (folderIdMap.get(g.folderId) ?? null) : null,
        title: typeof g.title === 'string' ? g.title : '',
        color: CHROME_GROUP_COLORS.includes(g.color) ? g.color : 'grey',
        collapsed: Boolean(g.collapsed),
        liveGroupId: null,
        liveWindowId: null,
        tabs: g.tabs
          .filter((t) => t && typeof t.url === 'string' && t.url.length > 0)
          .map((t) => ({
            url: t.url,
            title: t.title || t.url,
            favIconUrl: t.favIconUrl || '',
          })),
        order: typeof g.order === 'number' ? g.order : data.savedGroups.length,
        updatedAt: g.updatedAt || Date.now(),
      });
    }

    await setData(data);
    return data;
  });
}
