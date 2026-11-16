import {
  CHROME_GROUP_COLORS,
  createFolder,
  deleteFolder,
  deleteSavedGroup,
  exportLibraryJson,
  getData,
  getFolderPath,
  importLibraryJson,
  isDescendantFolder,
  moveFolder,
  moveSavedGroup,
  removeTabFromSavedGroup,
  renameFolder,
  saveGroupToLibrary,
  setThemeSetting,
  toggleFolderCollapsed,
  updateSavedGroup,
} from '../shared/storage.js';

import {
  assignTabToGroup,
  closeChromeGroup,
  closeChromeTab,
  createGroupFromTab,
  getAllWindowsState,
  mergeChromeGroups,
  reconcileLiveLinks,
  ungroupTab,
  updateChromeGroup,
} from '../shared/chrome-api.js';

async function sendSwMessage(payload) {
  return chrome.runtime.sendMessage(payload);
}

const SVG_CHEVRON = `<svg class="chevron" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const SVG_EDIT = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M11.5 2.5a1.4 1.4 0 0 1 2 2L5.5 12.5l-3 .75.75-3 8.25-7.75Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
const SVG_MERGE = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 3v4.5a2 2 0 0 0 2 2h4m0 0-2-2m2 2-2 2M12 3v10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const SVG_SAVE = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 2.5h8l2.5 2.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z" stroke="currentColor" stroke-width="1.4"/><path d="M5 2.5v3h5v-3M5 14V9.5h6V14" stroke="currentColor" stroke-width="1.3"/></svg>`;
const SVG_FOLDER = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 4a1.5 1.5 0 0 1 1.5-1.5h2.7L7.5 4h5A1.5 1.5 0 0 1 14 5.5v6.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12V4Z" stroke="currentColor" stroke-width="1.4"/></svg>`;
const SVG_MOVE = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.6l1.2 1.5h5.2A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5v-7Z" stroke="currentColor" stroke-width="1.3"/><path d="M6.5 9h3m0 0-1.3-1.3M9.5 9l-1.3 1.3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const SVG_CLOSE = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 4 8 8m0-8-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
const SVG_NEW_WIN = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="2.5" y="3.5" width="11" height="9" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M2.5 6.5h11" stroke="currentColor" stroke-width="1.3"/></svg>`;
const SVG_ADD_FOLDER = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 5v6M5 8h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
const SVG_GROUP_COLLAPSE = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2.5v11M2 8h3.5m0 0L4 6.5M5.5 8 4 9.5M14 8h-3.5m0 0L12 6.5M10.5 8 12 9.5" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const SVG_GROUP_EXPAND = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2.5v11M5.5 8H2m0 0L3.5 6.5M2 8l1.5 1.5M10.5 8H14m0 0L12.5 6.5M14 8l-1.5 1.5" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const state = {
  activeTab: 'active',
  searchQuery: '',
  data: { folders: [], savedGroups: [], settings: { theme: 'dark' } },
  windowsState: { currentWindowId: null, windows: [] },
  expandedActiveGroups: new Set(),
  expandedSavedGroups: new Set(),
  collapsedWindows: new Set(),
  dragPayload: null,
};

const els = {
  tabActive: document.getElementById('tab-active'),
  tabLibrary: document.getElementById('tab-library'),
  panelActive: document.getElementById('panel-active'),
  panelLibrary: document.getElementById('panel-library'),
  badgeActive: document.getElementById('badge-active-count'),
  badgeLibrary: document.getElementById('badge-library-count'),
  searchInput: document.getElementById('search-input'),
  clearSearch: document.getElementById('btn-clear-search'),
  btnNewFolderTop: document.getElementById('btn-new-folder-top'),
  btnSettings: document.getElementById('btn-settings'),
};

function applyTheme(theme) {
  const resolved = theme || 'dark';
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) {
    meta.content = resolved === 'system' ? 'light dark' : resolved;
  }
  try {
    localStorage.setItem('tgm-theme', resolved);
  } catch {
    // Ignore
  }
  document.querySelectorAll('.seg-btn[data-theme]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.theme === resolved);
  });
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'className') node.className = v;
    else if (k === 'textContent') node.textContent = v;
    else if (k === 'innerHTML') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (v !== undefined && v !== null && v !== false) {
      node.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const child of children) {
    if (child) node.append(child);
  }
  return node;
}

function makeFavicon(favIconUrl, title) {
  if (favIconUrl && !favIconUrl.startsWith('chrome://')) {
    const img = el('img', {
      className: 'tab-favicon',
      src: favIconUrl,
      alt: '',
    });
    img.addEventListener('error', () => {
      const fallback = el('span', {
        className: 'tab-favicon-fallback',
        textContent: (title || '?').slice(0, 1).toUpperCase(),
      });
      img.replaceWith(fallback);
    });
    return img;
  }
  return el('span', {
    className: 'tab-favicon-fallback',
    textContent: (title || '?').slice(0, 1).toUpperCase(),
  });
}

function matchesSearch(text) {
  if (!state.searchQuery) return true;
  return (text || '').toLowerCase().includes(state.searchQuery);
}

function tabMatchesSearch(tab) {
  if (!state.searchQuery) return true;
  return matchesSearch(tab.title) || matchesSearch(tab.url);
}

function switchTab(tabName) {
  state.activeTab = tabName;
  const isActive = tabName === 'active';
  els.tabActive.setAttribute('aria-selected', String(isActive));
  els.tabActive.tabIndex = isActive ? 0 : -1;
  els.tabLibrary.setAttribute('aria-selected', String(!isActive));
  els.tabLibrary.tabIndex = isActive ? -1 : 0;
  els.panelActive.hidden = !isActive;
  els.panelLibrary.hidden = isActive;
}

// --- Modal Dialog Helpers ---

function openEditGroupDialog({ title, color, onSave }) {
  const dlg = document.getElementById('dlg-edit-group');
  const nameInput = document.getElementById('edit-group-name');
  const colorsWrap = document.getElementById('edit-group-colors');

  let selectedColor = CHROME_GROUP_COLORS.includes(color) ? color : 'blue';
  nameInput.value = title || '';
  colorsWrap.innerHTML = '';

  for (const c of CHROME_GROUP_COLORS) {
    const swatch = el('button', {
      type: 'button',
      className: `color-swatch cg-${c}`,
      role: 'radio',
      'aria-label': c,
      'aria-checked': String(c === selectedColor),
      title: c,
      onClick: () => {
        selectedColor = c;
        colorsWrap.querySelectorAll('.color-swatch').forEach((s) => {
          s.setAttribute('aria-checked', String(s === swatch));
        });
      },
    });
    colorsWrap.append(swatch);
  }

  dlg.returnValue = '';
  dlg.showModal();
  nameInput.select();

  dlg.addEventListener(
    'close',
    async () => {
      const val = dlg.returnValue;
      dlg.returnValue = '';
      if (val === 'save') {
        await onSave({ title: nameInput.value.trim(), color: selectedColor });
        await refresh();
      }
    },
    { once: true }
  );
}

function populateFolderSelect(selectEl, folders, { excludeFolderId = null, selectedId = null } = {}) {
  selectEl.innerHTML = '';
  selectEl.append(el('option', { value: '', textContent: 'Unfiled (Root)' }));

  function addOptions(parentId, depth) {
    const children = folders
      .filter((f) => (f.parentId ?? null) === parentId)
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const f of children) {
      if (excludeFolderId && (f.id === excludeFolderId || isDescendantFolder(folders, f.id, excludeFolderId))) {
        continue;
      }
      const prefix = depth > 0 ? `${'  '.repeat(depth)}└ ` : '';
      const opt = el('option', { value: f.id, textContent: `${prefix}${f.name}` });
      if (f.id === selectedId) opt.selected = true;
      selectEl.append(opt);
      addOptions(f.id, depth + 1);
    }
  }
  addOptions(null, 0);
}

function openFolderPickDialog({ title = 'Save to Folder', currentFolderId = null, onConfirm }) {
  const dlg = document.getElementById('dlg-folder-pick');
  document.getElementById('dlg-folder-pick-title').textContent = title;
  const selectEl = document.getElementById('folder-pick-select');
  const newInput = document.getElementById('folder-pick-new-name');
  const createBtn = document.getElementById('btn-folder-pick-create');

  newInput.value = '';
  populateFolderSelect(selectEl, state.data.folders, { selectedId: currentFolderId });

  const handleCreate = async () => {
    const name = newInput.value.trim();
    if (!name) return;
    const created = await createFolder(name, selectEl.value || null);
    state.data = await getData();
    populateFolderSelect(selectEl, state.data.folders, { selectedId: created.id });
    newInput.value = '';
  };

  createBtn.onclick = handleCreate;
  dlg.returnValue = '';
  dlg.showModal();

  dlg.addEventListener(
    'close',
    async () => {
      createBtn.onclick = null;
      const val = dlg.returnValue;
      dlg.returnValue = '';
      if (val === 'confirm') {
        await onConfirm(selectEl.value || null);
        await refresh();
      }
    },
    { once: true }
  );
}

function openMergeDialog(sourceGroup) {
  const allOpenGroups = state.windowsState.windows.flatMap((w) =>
    w.groups.map((g) => ({ ...g, isCurrentWindow: w.isCurrent }))
  );
  const candidates = allOpenGroups.filter((g) => g.id !== sourceGroup.id);
  if (candidates.length === 0) return;

  const dlg = document.getElementById('dlg-merge-group');
  const desc = document.getElementById('merge-desc');
  const selectEl = document.getElementById('merge-target-select');

  const srcName = sourceGroup.title || 'Untitled group';
  desc.textContent = `Move all ${sourceGroup.tabs.length} tab(s) from "${srcName}" into:`;
  selectEl.innerHTML = '';

  for (const g of candidates) {
    const winTag = g.isCurrentWindow ? '' : ' (Other window)';
    const label = `${g.title || 'Untitled group'} (${g.tabs.length} tabs)${winTag}`;
    selectEl.append(el('option', { value: String(g.id), textContent: label }));
  }

  dlg.returnValue = '';
  dlg.showModal();

  dlg.addEventListener(
    'close',
    async () => {
      const val = dlg.returnValue;
      dlg.returnValue = '';
      if (val === 'merge' && selectEl.value) {
        await mergeChromeGroups(sourceGroup.id, Number(selectEl.value));
        await refresh();
      }
    },
    { once: true }
  );
}

function openFolderDialog({ mode = 'create', folder = null, parentId = null }) {
  const dlg = document.getElementById('dlg-folder');
  const titleEl = document.getElementById('dlg-folder-title');
  const nameInput = document.getElementById('folder-name-input');
  const parentWrap = document.getElementById('folder-parent-wrap');
  const parentSelect = document.getElementById('folder-parent-select');

  if (mode === 'rename' && folder) {
    titleEl.textContent = 'Rename Folder';
    nameInput.value = folder.name;
    parentWrap.hidden = true;
  } else {
    titleEl.textContent = parentId ? 'New Subfolder' : 'New Folder';
    nameInput.value = '';
    parentWrap.hidden = false;
    populateFolderSelect(parentSelect, state.data.folders, { selectedId: parentId });
  }

  dlg.returnValue = '';
  dlg.showModal();
  nameInput.select();

  dlg.addEventListener(
    'close',
    async () => {
      const val = dlg.returnValue;
      dlg.returnValue = '';
      if (val === 'save') {
        const name = nameInput.value.trim();
        if (!name) return;
        if (mode === 'rename' && folder) {
          await renameFolder(folder.id, name);
        } else {
          await createFolder(name, parentSelect.value || null);
        }
        await refresh();
      }
    },
    { once: true }
  );
}

function openConfirmDialog({ title, message, onConfirm }) {
  const dlg = document.getElementById('dlg-confirm');
  document.getElementById('dlg-confirm-title').textContent = title;
  document.getElementById('confirm-message').textContent = message;

  dlg.returnValue = '';
  dlg.showModal();

  dlg.addEventListener(
    'close',
    async () => {
      const val = dlg.returnValue;
      dlg.returnValue = '';
      if (val === 'confirm') {
        await onConfirm();
        await refresh();
      }
    },
    { once: true }
  );
}

// --- Rendering: Active View ---

function renderActiveView() {
  const container = els.panelActive;
  container.innerHTML = '';

  const allOpenGroups = state.windowsState.windows.flatMap((w) => w.groups);
  const linkedByLiveId = new Map(
    state.data.savedGroups
      .filter((g) => g.liveGroupId !== null && g.liveGroupId !== undefined)
      .map((g) => [g.liveGroupId, g])
  );

  let totalVisibleGroups = 0;

  for (const win of state.windowsState.windows) {
    const filteredGroups = win.groups.filter(
      (g) => matchesSearch(g.title || 'Untitled group') || g.tabs.some(tabMatchesSearch)
    );
    const filteredUngrouped = win.ungroupedTabs.filter(tabMatchesSearch);

    if (state.searchQuery && filteredGroups.length === 0 && filteredUngrouped.length === 0) {
      continue;
    }

    totalVisibleGroups += filteredGroups.length;

    const winCard = el('div', { className: 'window-card' });
    const isCollapsed = state.collapsedWindows.has(win.id);
    const winLabel = win.isCurrent ? 'Current Window' : `Window ${win.id}`;

    const headerBtn = el(
      'button',
      {
        type: 'button',
        className: 'window-header-left',
        onClick: () => {
          if (state.collapsedWindows.has(win.id)) state.collapsedWindows.delete(win.id);
          else state.collapsedWindows.add(win.id);
          renderActiveView();
        },
      },
      [
        el('span', {
          className: `chevron-wrap`,
          innerHTML: SVG_CHEVRON,
        }),
        el('span', { textContent: winLabel }),
      ]
    );
    const chev = headerBtn.querySelector('.chevron');
    if (chev && !isCollapsed) chev.classList.add('expanded');

    winCard.append(
      el('div', { className: 'window-header' }, [
        headerBtn,
        el('span', {
          textContent: `${win.groups.length} groups · ${win.ungroupedTabs.length} ungrouped`,
        }),
      ])
    );

    if (!isCollapsed) {
      // Open Groups
      for (const group of filteredGroups) {
        const linked = linkedByLiveId.get(group.id);
        const isExpanded = state.expandedActiveGroups.has(group.id) || Boolean(state.searchQuery);

        const card = el('div', { className: 'group-card' });

        card.addEventListener('dragover', (e) => {
          if (state.dragPayload?.type !== 'active-tab') return;
          if (state.dragPayload.sourceGroupId === group.id) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          card.classList.add('drop-target');
        });

        card.addEventListener('dragleave', (e) => {
          if (!card.contains(e.relatedTarget)) {
            card.classList.remove('drop-target');
          }
        });

        card.addEventListener('drop', async (e) => {
          e.preventDefault();
          card.classList.remove('drop-target');
          const payload = state.dragPayload;
          state.dragPayload = null;
          if (!payload || payload.type !== 'active-tab' || payload.sourceGroupId === group.id) return;
          await assignTabToGroup(payload.tabId, group.id, group.windowId);
          await refresh();
        });

        const toggleBtn = el(
          'button',
          {
            type: 'button',
            className: 'group-toggle',
            onClick: () => {
              if (state.expandedActiveGroups.has(group.id)) state.expandedActiveGroups.delete(group.id);
              else state.expandedActiveGroups.add(group.id);
              renderActiveView();
            },
          },
          [
            el('span', { innerHTML: SVG_CHEVRON }),
            el('span', { className: `group-color-pill cg-${group.color}` }),
            el('span', {
              className: 'group-title',
              textContent: group.title || 'Untitled group',
            }),
            el('span', { className: 'group-count', textContent: `(${group.tabs.length})` }),
          ]
        );
        const gChev = toggleBtn.querySelector('.chevron');
        if (gChev && isExpanded) gChev.classList.add('expanded');

        const statusPill = linked
          ? el('span', { className: 'status-pill open-saved', title: 'Auto-synced with Library' }, [
              el('span', { className: 'status-dot' }),
              el('span', { textContent: 'Saved' }),
            ])
          : el('span', { className: 'status-pill unsaved', textContent: 'Unsaved' });

        const actions = el('div', { className: 'group-actions' });

        // Collapse/expand in Chrome strip
        actions.append(
          el('button', {
            type: 'button',
            className: 'icon-btn',
            title: group.collapsed ? 'Expand group in Chrome' : 'Collapse group in Chrome',
            innerHTML: group.collapsed ? SVG_GROUP_EXPAND : SVG_GROUP_COLLAPSE,
            onClick: async () => {
              await updateChromeGroup(group.id, { collapsed: !group.collapsed });
              await refresh();
            },
          })
        );

        // Edit name & color
        actions.append(
          el('button', {
            type: 'button',
            className: 'icon-btn',
            title: 'Rename & recolor',
            innerHTML: SVG_EDIT,
            onClick: () => {
              openEditGroupDialog({
                title: group.title,
                color: group.color,
                onSave: async ({ title, color }) => {
                  await updateChromeGroup(group.id, { title, color });
                },
              });
            },
          })
        );

        // Merge with another group
        if (allOpenGroups.length > 1) {
          actions.append(
            el('button', {
              type: 'button',
              className: 'icon-btn',
              title: 'Merge into another group',
              innerHTML: SVG_MERGE,
              onClick: () => openMergeDialog(group),
            })
          );
        }

        // Save to folder / Move folder
        actions.append(
          el('button', {
            type: 'button',
            className: 'icon-btn',
            title: linked ? 'Move saved group to folder' : 'Save group to folder',
            innerHTML: linked ? SVG_MOVE : SVG_SAVE,
            onClick: () => {
              openFolderPickDialog({
                title: linked ? 'Move Saved Group' : 'Save Group to Folder',
                currentFolderId: linked?.folderId ?? null,
                onConfirm: async (folderId) => {
                  if (linked) {
                    await moveSavedGroup(linked.id, folderId);
                  } else {
                    await saveGroupToLibrary({
                      title: group.title,
                      color: group.color,
                      collapsed: group.collapsed,
                      tabs: group.tabs,
                      folderId,
                      liveGroupId: group.id,
                      liveWindowId: group.windowId,
                    });
                  }
                },
              });
            },
          })
        );

        // Close group
        actions.append(
          el('button', {
            type: 'button',
            className: 'icon-btn danger',
            title: linked ? 'Close group (keeps saved copy)' : 'Close group',
            innerHTML: SVG_CLOSE,
            onClick: async () => {
              await closeChromeGroup(group.id);
              await refresh();
            },
          })
        );

        const headerRow = el('div', { className: 'group-header' }, [toggleBtn]);
        if (linked) {
          const path = getFolderPath(state.data.folders, linked.folderId);
          headerRow.append(el('span', { className: 'folder-tag', title: path, textContent: path }));
        }
        headerRow.append(statusPill, actions);
        card.append(headerRow);

        if (isExpanded) {
          const tabList = el('div', { className: 'tab-list' });
          const tabsToShow = state.searchQuery ? group.tabs.filter(tabMatchesSearch) : group.tabs;
          for (const t of tabsToShow) {
            const row = el('div', { className: `tab-row${t.active ? ' is-active' : ''}`, draggable: 'true' }, [
              el(
                'button',
                {
                  type: 'button',
                  className: 'tab-main',
                  title: t.url,
                  onClick: async () => {
                    await sendSwMessage({ type: 'FOCUS_TAB', tabId: t.id, windowId: t.windowId });
                  },
                },
                [makeFavicon(t.favIconUrl, t.title), el('span', { className: 'tab-title', textContent: t.title })]
              ),
              el('button', {
                type: 'button',
                className: 'icon-btn',
                title: 'Ungroup tab',
                textContent: '↗',
                onClick: async () => {
                  await ungroupTab(t.id);
                  await refresh();
                },
              }),
              el('button', {
                type: 'button',
                className: 'icon-btn danger',
                title: 'Close tab',
                innerHTML: SVG_CLOSE,
                onClick: async () => {
                  await closeChromeTab(t.id);
                  await refresh();
                },
              }),
            ]);
            row.addEventListener('dragstart', (e) => {
              state.dragPayload = {
                type: 'active-tab',
                tabId: t.id,
                sourceGroupId: group.id,
                windowId: t.windowId,
              };
              row.classList.add('dragging');
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', String(t.id));
            });
            row.addEventListener('dragend', () => {
              row.classList.remove('dragging');
              state.dragPayload = null;
              document.querySelectorAll('.drop-target').forEach((n) => n.classList.remove('drop-target'));
            });
            tabList.append(row);
          }
          card.append(tabList);
        }

        winCard.append(card);
      }

      // Ungrouped Tabs
      if (filteredUngrouped.length > 0) {
        winCard.append(
          el('div', { className: 'section-header' }, [
            el('span', { className: 'section-title', textContent: 'Ungrouped Tabs' }),
          ])
        );
        const ungroupedCard = el('div', { className: 'ungrouped-card' });
        const list = el('div', { className: 'tab-list' });

        for (const t of filteredUngrouped) {
          const select = el('select', {
            className: 'assign-select',
            'aria-label': `Assign ${t.title} to group`,
          });
          select.append(el('option', { value: '', textContent: '+ Add to group' }));
          select.append(el('option', { value: '__new__', textContent: '+ New group...' }));

          for (const g of allOpenGroups) {
            const winSuffix = g.windowId === win.id ? '' : ' (Other win)';
            select.append(
              el('option', {
                value: `${g.id}:${g.windowId}`,
                textContent: `${g.title || 'Untitled group'}${winSuffix}`,
              })
            );
          }

          select.addEventListener('change', async () => {
            const val = select.value;
            if (!val) return;
            if (val === '__new__') {
              const newGroupId = await createGroupFromTab(t.id, {
                title: '',
                color: 'blue',
                windowId: t.windowId,
              });
              await refresh();
              openEditGroupDialog({
                title: '',
                color: 'blue',
                onSave: async ({ title, color }) => {
                  await updateChromeGroup(newGroupId, { title, color });
                },
              });
            } else {
              const [gid, wid] = val.split(':').map(Number);
              await assignTabToGroup(t.id, gid, wid);
              await refresh();
            }
          });

          const ungroupedRow = el(
            'div',
            { className: `tab-row${t.active ? ' is-active' : ''}`, draggable: 'true' },
            [
              el(
                'button',
                {
                  type: 'button',
                  className: 'tab-main',
                  title: t.url,
                  onClick: async () => {
                    await sendSwMessage({ type: 'FOCUS_TAB', tabId: t.id, windowId: t.windowId });
                  },
                },
                [makeFavicon(t.favIconUrl, t.title), el('span', { className: 'tab-title', textContent: t.title })]
              ),
              select,
            ]
          );
          ungroupedRow.addEventListener('dragstart', (e) => {
            state.dragPayload = {
              type: 'active-tab',
              tabId: t.id,
              sourceGroupId: null,
              windowId: t.windowId,
            };
            ungroupedRow.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', String(t.id));
          });
          ungroupedRow.addEventListener('dragend', () => {
            ungroupedRow.classList.remove('dragging');
            state.dragPayload = null;
            document.querySelectorAll('.drop-target').forEach((n) => n.classList.remove('drop-target'));
          });
          list.append(ungroupedRow);
        }

        ungroupedCard.append(list);
        winCard.append(ungroupedCard);
      }
    }

    container.append(winCard);
  }

  els.badgeActive.textContent = String(allOpenGroups.length);

  if (container.children.length === 0) {
    container.append(
      el('div', { className: 'empty-state' }, [
        el('p', {
          textContent: state.searchQuery
            ? 'No active groups or tabs match your search.'
            : 'No open tabs or groups found.',
        }),
      ])
    );
  }
}

// --- Rendering: Library View (Nested Folders + Drag & Drop) ---

function attachDropTarget(element, targetFolderId) {
  element.addEventListener('dragover', (e) => {
    if (!state.dragPayload) return;
    if (
      state.dragPayload.type === 'folder' &&
      (state.dragPayload.id === targetFolderId ||
        isDescendantFolder(state.data.folders, targetFolderId, state.dragPayload.id))
    ) {
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    element.classList.add('drop-target');
  });

  element.addEventListener('dragleave', () => {
    element.classList.remove('drop-target');
  });

  element.addEventListener('drop', async (e) => {
    e.preventDefault();
    element.classList.remove('drop-target');
    const payload = state.dragPayload;
    state.dragPayload = null;
    if (!payload) return;

    if (payload.type === 'group') {
      await moveSavedGroup(payload.id, targetFolderId);
      await refresh();
    } else if (payload.type === 'folder') {
      if (
        payload.id !== targetFolderId &&
        !isDescendantFolder(state.data.folders, targetFolderId, payload.id)
      ) {
        await moveFolder(payload.id, targetFolderId);
        await refresh();
      }
    }
  });
}

function renderSavedGroupCard(group) {
  const isOpen = group.liveGroupId !== null && group.liveGroupId !== undefined;
  const isExpanded = state.expandedSavedGroups.has(group.id) || Boolean(state.searchQuery);

  const card = el('div', {
    className: 'group-card',
    draggable: 'true',
  });

  card.addEventListener('dragstart', (e) => {
    state.dragPayload = { type: 'group', id: group.id };
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', group.id);
  });

  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    state.dragPayload = null;
    document.querySelectorAll('.drop-target').forEach((n) => n.classList.remove('drop-target'));
  });

  const toggleBtn = el(
    'button',
    {
      type: 'button',
      className: 'group-toggle',
      onClick: () => {
        if (state.expandedSavedGroups.has(group.id)) state.expandedSavedGroups.delete(group.id);
        else state.expandedSavedGroups.add(group.id);
        renderLibraryView();
      },
    },
    [
      el('span', { innerHTML: SVG_CHEVRON }),
      el('span', { className: `group-color-pill cg-${group.color}` }),
      el('span', { className: 'group-title', textContent: group.title || 'Untitled group' }),
      el('span', { className: 'group-count', textContent: `(${group.tabs.length})` }),
    ]
  );
  const chev = toggleBtn.querySelector('.chevron');
  if (chev && isExpanded) chev.classList.add('expanded');

  const statusPill = isOpen
    ? el('span', { className: 'status-pill open-saved' }, [
        el('span', { className: 'status-dot' }),
        el('span', { textContent: 'Open' }),
      ])
    : el('span', { className: 'status-pill closed', textContent: 'Closed' });

  const actions = el('div', { className: 'group-actions' });

  if (isOpen) {
    actions.append(
      el('button', {
        type: 'button',
        className: 'btn btn-sm btn-primary',
        textContent: 'Focus',
        onClick: async () => {
          await sendSwMessage({
            type: 'FOCUS_GROUP',
            groupId: group.liveGroupId,
            windowId: group.liveWindowId,
          });
        },
      }),
      el('button', {
        type: 'button',
        className: 'icon-btn',
        title: 'Close group in Chrome (keeps saved)',
        innerHTML: SVG_CLOSE,
        onClick: async () => {
          await closeChromeGroup(group.liveGroupId);
          await refresh();
        },
      })
    );
  } else {
    actions.append(
      el('button', {
        type: 'button',
        className: 'btn btn-sm btn-secondary',
        textContent: 'Open',
        title: 'Reopen in current window',
        onClick: async () => {
          await sendSwMessage({
            type: 'OPEN_SAVED_GROUP',
            savedGroup: group,
            options: { inNewWindow: false },
          });
          await refresh();
        },
      }),
      el('button', {
        type: 'button',
        className: 'icon-btn',
        title: 'Open in new window',
        innerHTML: SVG_NEW_WIN,
        onClick: async () => {
          await sendSwMessage({
            type: 'OPEN_SAVED_GROUP',
            savedGroup: group,
            options: { inNewWindow: true },
          });
          await refresh();
        },
      })
    );
  }

  actions.append(
    el('button', {
      type: 'button',
      className: 'icon-btn',
      title: 'Edit name & color',
      innerHTML: SVG_EDIT,
      onClick: () => {
        openEditGroupDialog({
          title: group.title,
          color: group.color,
          onSave: async ({ title, color }) => {
            await updateSavedGroup(group.id, { title, color });
            if (isOpen) {
              try {
                await updateChromeGroup(group.liveGroupId, { title, color });
              } catch {
                // Ignore if closed in meantime
              }
            }
          },
        });
      },
    }),
    el('button', {
      type: 'button',
      className: 'icon-btn',
      title: 'Move to folder',
      innerHTML: SVG_MOVE,
      onClick: () => {
        openFolderPickDialog({
          title: 'Move to Folder',
          currentFolderId: group.folderId,
          onConfirm: async (folderId) => {
            await moveSavedGroup(group.id, folderId);
          },
        });
      },
    }),
    el('button', {
      type: 'button',
      className: 'icon-btn danger',
      title: 'Delete saved group',
      innerHTML: SVG_CLOSE,
      onClick: () => {
        openConfirmDialog({
          title: 'Delete Saved Group',
          message: `Remove "${group.title || 'Untitled group'}" from your Library?`,
          onConfirm: async () => {
            await deleteSavedGroup(group.id);
          },
        });
      },
    })
  );

  card.append(el('div', { className: 'group-header' }, [toggleBtn, statusPill, actions]));

  if (isExpanded) {
    const tabList = el('div', { className: 'tab-list' });
    group.tabs.forEach((t, idx) => {
      if (state.searchQuery && !tabMatchesSearch(t)) return;
      tabList.append(
        el('div', { className: 'tab-row' }, [
          el(
            'button',
            {
              type: 'button',
              className: 'tab-main',
              title: `Open single tab: ${t.url}`,
              onClick: async () => {
                await chrome.tabs.create({ url: t.url, active: true });
              },
            },
            [makeFavicon(t.favIconUrl, t.title), el('span', { className: 'tab-title', textContent: t.title })]
          ),
          el('button', {
            type: 'button',
            className: 'icon-btn danger',
            title: 'Remove tab from saved group',
            innerHTML: SVG_CLOSE,
            onClick: async () => {
              await removeTabFromSavedGroup(group.id, idx);
              await refresh();
            },
          }),
        ])
      );
    });
    card.append(tabList);
  }

  return card;
}

function folderHasMatches(folderId, folders, savedGroups) {
  const f = folders.find((x) => x.id === folderId);
  if (f && matchesSearch(f.name)) return true;
  const directGroups = savedGroups.filter((g) => (g.folderId ?? null) === folderId);
  if (
    directGroups.some(
      (g) => matchesSearch(g.title || 'Untitled group') || g.tabs.some(tabMatchesSearch)
    )
  ) {
    return true;
  }
  const childFolders = folders.filter((x) => (x.parentId ?? null) === folderId);
  return childFolders.some((cf) => folderHasMatches(cf.id, folders, savedGroups));
}

function renderFolderNode(folder, folders, savedGroups) {
  if (state.searchQuery && !folderHasMatches(folder.id, folders, savedGroups)) {
    return null;
  }

  const isCollapsed = state.searchQuery ? false : Boolean(folder.collapsed);
  const childFolders = folders
    .filter((f) => (f.parentId ?? null) === folder.id)
    .sort((a, b) => a.name.localeCompare(b.name));
  const childGroups = savedGroups
    .filter((g) => (g.folderId ?? null) === folder.id)
    .filter(
      (g) =>
        !state.searchQuery ||
        matchesSearch(folder.name) ||
        matchesSearch(g.title || 'Untitled group') ||
        g.tabs.some(tabMatchesSearch)
    );

  const node = el('div', { className: 'folder-node' });
  const box = el('div', { className: 'folder-box' });

  const header = el('div', { className: 'folder-header', draggable: 'true' });
  attachDropTarget(header, folder.id);

  header.addEventListener('dragstart', (e) => {
    state.dragPayload = { type: 'folder', id: folder.id };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', folder.id);
  });

  header.addEventListener('dragend', () => {
    state.dragPayload = null;
    document.querySelectorAll('.drop-target').forEach((n) => n.classList.remove('drop-target'));
  });

  const toggleBtn = el(
    'button',
    {
      type: 'button',
      className: 'group-toggle',
      onClick: async () => {
        await toggleFolderCollapsed(folder.id, !folder.collapsed);
        await refresh();
      },
    },
    [
      el('span', { innerHTML: SVG_CHEVRON }),
      el('span', { innerHTML: SVG_FOLDER }),
      el('span', { className: 'folder-name', textContent: folder.name }),
      el('span', {
        className: 'group-count',
        textContent: `(${childGroups.length + childFolders.length})`,
      }),
    ]
  );
  const chev = toggleBtn.querySelector('.chevron');
  if (chev && !isCollapsed) chev.classList.add('expanded');

  const actions = el('div', { className: 'group-actions' }, [
    el('button', {
      type: 'button',
      className: 'icon-btn',
      title: 'New subfolder',
      innerHTML: SVG_ADD_FOLDER,
      onClick: (e) => {
        e.stopPropagation();
        openFolderDialog({ mode: 'create', parentId: folder.id });
      },
    }),
    el('button', {
      type: 'button',
      className: 'icon-btn',
      title: 'Rename folder',
      innerHTML: SVG_EDIT,
      onClick: (e) => {
        e.stopPropagation();
        openFolderDialog({ mode: 'rename', folder });
      },
    }),
    el('button', {
      type: 'button',
      className: 'icon-btn danger',
      title: 'Delete folder',
      innerHTML: SVG_CLOSE,
      onClick: (e) => {
        e.stopPropagation();
        openConfirmDialog({
          title: 'Delete Folder',
          message: `Delete "${folder.name}"? Any saved groups inside will be moved to Unfiled.`,
          onConfirm: async () => {
            await deleteFolder(folder.id, { deleteGroups: false });
          },
        });
      },
    }),
  ]);

  header.append(toggleBtn, actions);
  box.append(header);

  if (!isCollapsed) {
    const childrenWrap = el('div', { className: 'folder-children' });
    for (const cf of childFolders) {
      const childEl = renderFolderNode(cf, folders, savedGroups);
      if (childEl) childrenWrap.append(childEl);
    }
    for (const cg of childGroups) {
      childrenWrap.append(renderSavedGroupCard(cg));
    }
    if (childrenWrap.children.length === 0) {
      childrenWrap.append(
        el('div', {
          className: 'modal-desc',
          style: 'padding: 6px 4px;',
          textContent: 'Empty folder — drag groups or subfolders here.',
        })
      );
    }
    box.append(childrenWrap);
  }

  node.append(box);
  return node;
}

function renderLibraryView() {
  const container = els.panelLibrary;
  container.innerHTML = '';

  const { folders, savedGroups } = state.data;
  els.badgeLibrary.textContent = String(savedGroups.length);

  const rootFolders = folders
    .filter((f) => !f.parentId)
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const folder of rootFolders) {
    const node = renderFolderNode(folder, folders, savedGroups);
    if (node) container.append(node);
  }

  const unfiledGroups = savedGroups
    .filter((g) => !g.folderId)
    .filter(
      (g) =>
        !state.searchQuery ||
        matchesSearch(g.title || 'Untitled group') ||
        g.tabs.some(tabMatchesSearch)
    );

  if (unfiledGroups.length > 0 || folders.length > 0) {
    const rootDrop = el('div', { className: 'root-drop-zone' });
    attachDropTarget(rootDrop, null);
    rootDrop.append(
      el('div', {
        className: 'root-drop-label',
        textContent: unfiledGroups.length > 0 ? 'Unfiled Groups' : 'Drop here to move to Root / Unfiled',
      })
    );
    for (const g of unfiledGroups) {
      rootDrop.append(renderSavedGroupCard(g));
    }
    container.append(rootDrop);
  }

  if (savedGroups.length === 0 && folders.length === 0) {
    container.append(
      el('div', { className: 'empty-state' }, [
        el('p', { textContent: 'Your Library is empty.' }),
        el('p', { textContent: 'Save any open group from the Active tab, or create a folder to organize your workflow.' }),
        el('button', {
          type: 'button',
          className: 'btn btn-primary',
          textContent: '+ Create First Folder',
          onClick: () => openFolderDialog({ mode: 'create' }),
        }),
      ])
    );
  }
}

async function refresh() {
  state.data = await reconcileLiveLinks();
  state.windowsState = await getAllWindowsState();
  applyTheme(state.data.settings.theme);
  renderActiveView();
  renderLibraryView();
}

// --- Event Listeners ---

els.tabActive.addEventListener('click', () => switchTab('active'));
els.tabLibrary.addEventListener('click', () => switchTab('library'));

[els.tabActive, els.tabLibrary].forEach((tabBtn) => {
  tabBtn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const next = state.activeTab === 'active' ? 'library' : 'active';
      switchTab(next);
      (next === 'active' ? els.tabActive : els.tabLibrary).focus();
    }
  });
});

els.searchInput.addEventListener('input', () => {
  state.searchQuery = els.searchInput.value.trim().toLowerCase();
  els.clearSearch.hidden = state.searchQuery.length === 0;
  renderActiveView();
  renderLibraryView();
});

els.clearSearch.addEventListener('click', () => {
  els.searchInput.value = '';
  state.searchQuery = '';
  els.clearSearch.hidden = true;
  renderActiveView();
  renderLibraryView();
  els.searchInput.focus();
});

els.btnNewFolderTop.addEventListener('click', () => {
  switchTab('library');
  openFolderDialog({ mode: 'create' });
});

// Settings & Backup
els.btnSettings.addEventListener('click', () => {
  document.getElementById('import-status').hidden = true;
  document.getElementById('dlg-settings').showModal();
});

document.querySelectorAll('.seg-btn[data-theme]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const theme = btn.dataset.theme;
    applyTheme(theme);
    await setThemeSetting(theme);
  });
});

document.getElementById('btn-export-json').addEventListener('click', async () => {
  const payload = await exportLibraryJson();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tab-groups-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

const importInput = document.getElementById('import-file-input');
document.getElementById('btn-import-json').addEventListener('click', () => {
  importInput.value = '';
  importInput.click();
});

importInput.addEventListener('change', async () => {
  const file = importInput.files?.[0];
  if (!file) return;
  const statusEl = document.getElementById('import-status');
  try {
    const text = await file.text();
    const json = JSON.parse(text);
    await importLibraryJson(json, 'merge');
    statusEl.textContent = 'Backup imported and merged successfully.';
    statusEl.style.color = 'var(--green)';
    statusEl.hidden = false;
    await refresh();
  } catch (err) {
    statusEl.textContent = err.message || 'Failed to import backup.';
    statusEl.style.color = 'var(--danger)';
    statusEl.hidden = false;
  }
});

// Keep UI updated if background auto-sync changes storage while popup is open
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.tgm_data) {
    refresh();
  }
});

refresh();
