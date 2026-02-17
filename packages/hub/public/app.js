// Roblox Studio Hub - Web UI (Dynamic Tool Forms)

const API_BASE = '';
let pollTimer = null;
let lastEventTimestamp = 0;
let selectedStudioId = null;
let selectedToolName = null;
let studiosCache = [];
let pluginToolsCache = [];

// DOM Elements
const hubStatus = document.getElementById('hubStatus');
const studiosList = document.getElementById('studiosList');
const toolSelector = document.getElementById('toolSelector');
const toolForm = document.getElementById('toolForm');
const resultBox = document.getElementById('resultBox');
const toolWebSection = document.getElementById('toolWebSection');
const toolWebIframe = document.getElementById('toolWebIframe');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  initUI();
});

async function initUI() {
  updateHubStatus(false, 'Connecting...');

  try {
    const res = await fetch(API_BASE + '/api/ui/init');
    if (!res.ok) throw new Error('Failed to fetch init data');

    const data = await res.json();
    studiosCache = data.studios || [];
    pluginToolsCache = data.pluginTools || [];
    renderStudios();
    updateHubStatus(true);
    startPolling();
  } catch (e) {
    console.error('[UI] Init failed:', e);
    updateHubStatus(false, 'Connection failed');
    setTimeout(initUI, 3000);
  }
}

// Long polling
function startPolling() {
  if (pollTimer) clearTimeout(pollTimer);
  poll();
}

async function poll() {
  try {
    const res = await fetch(API_BASE + '/api/ui/poll?since=' + lastEventTimestamp + '&timeout=30');
    if (!res.ok) throw new Error('Poll failed');

    const data = await res.json();

    if (data.events && data.events.length > 0) {
      for (const event of data.events) {
        handleEvent(event);
        if (event.timestamp > lastEventTimestamp) {
          lastEventTimestamp = event.timestamp;
        }
      }
    }

    pollTimer = setTimeout(poll, 0);
  } catch (e) {
    console.error('[UI] Poll error:', e);
    updateHubStatus(false, 'Disconnected');
    pollTimer = setTimeout(() => {
      updateHubStatus(false, 'Reconnecting...');
      initUI();
    }, 3000);
  }
}

function handleEvent(event) {
  updateHubStatus(true);

  switch (event.type) {
    case 'studio_connected': {
      const studio = event.data.studio;
      studiosCache = studiosCache.filter(s => s.id !== studio.id);
      studiosCache.push(studio);
      renderStudios();
      break;
    }
    case 'studio_disconnected': {
      const disconnectedId = event.data.studioId;
      studiosCache = studiosCache.filter(s => s.id !== disconnectedId);
      if (selectedStudioId === disconnectedId) {
        selectedStudioId = null;
        selectedToolName = null;
      }
      renderStudios();
      break;
    }
  }
}

// Render studios list
function renderStudios() {
  if (studiosCache.length > 0) {
    if (!selectedStudioId || !studiosCache.some(s => s.id === selectedStudioId)) {
      selectedStudioId = studiosCache[0].id;
    }
  } else {
    selectedStudioId = null;
  }

  if (studiosCache.length === 0) {
    studiosList.innerHTML = '<div class="empty-state">No connections</div>';
    toolSelector.innerHTML = '';
    toolForm.innerHTML = '<div class="empty-state">Select a Studio to view available tools</div>';
    return;
  }

  studiosList.innerHTML = studiosCache.map(s => {
    const displayName = escapeHtml(s.placeName);
    const metaInfo = s.localPath ? escapeHtml(s.localPath) : formatTime(s.connectedAt);
    const typeClass = s.type === 'place' ? 'type-place' : 'type-local';
    const stateClass = s.gameState === 'play' ? 'state-play' : 'state-edit';

    return '<div class="studio-card' + (s.id === selectedStudioId ? ' selected' : '') + '" data-id="' + s.id + '">' +
      '<div class="studio-info">' +
        '<div class="studio-name">' + displayName + '</div>' +
        '<div class="studio-meta">' + metaInfo + '</div>' +
      '</div>' +
      '<div class="studio-badges">' +
        '<span class="badge ' + typeClass + '">' + s.type + '</span>' +
        '<span class="badge ' + stateClass + '">' + (s.gameState || 'edit') + '</span>' +
      '</div>' +
    '</div>';
  }).join('');

  studiosList.querySelectorAll('.studio-card').forEach(card => {
    card.addEventListener('click', () => {
      selectedStudioId = card.dataset.id;
      selectedToolName = null;
      renderStudios();
    });
  });

  renderToolSelector();
}

// Get selected studio
function getSelectedStudio() {
  return studiosCache.find(s => s.id === selectedStudioId) || null;
}

// Render tool selector buttons
function renderToolSelector() {
  const studio = getSelectedStudio();
  if (!studio) {
    toolSelector.innerHTML = '';
    toolForm.innerHTML = '<div class="empty-state">Select a Studio</div>';
    return;
  }

  // Merge studio methods + Hub methods (startGame/stopGame from pluginTools)
  const methods = getMergedMethods(studio);

  if (methods.length === 0) {
    toolSelector.innerHTML = '';
    toolForm.innerHTML = '<div class="empty-state">No tools available</div>';
    return;
  }

  if (!selectedToolName || !methods.some(m => m.name === selectedToolName)) {
    selectedToolName = methods[0].name;
  }

  toolSelector.innerHTML = methods.map(m => {
    return '<button class="tool-btn' + (m.name === selectedToolName ? ' active' : '') + '" data-tool="' + m.name + '">' +
      escapeHtml(m.name) + '</button>';
  }).join('');

  toolSelector.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedToolName = btn.dataset.tool;
      renderToolSelector();
    });
  });

  renderToolForm();
}

// Merge studio runtime methods with plugin tools (for schema info like web, x-file)
function getMergedMethods(studio) {
  const methods = [...(studio.methods || [])];

  // Add Hub-side methods from pluginTools if not in studio.methods
  for (const pt of pluginToolsCache) {
    if (!methods.some(m => m.name === pt.name)) {
      methods.push({
        name: pt.name,
        description: pt.description,
        inputSchema: pt.inputSchema,
        web: pt.web,
      });
    }
  }

  return methods;
}

// Render dynamic form for selected tool
function renderToolForm() {
  const studio = getSelectedStudio();
  if (!studio || !selectedToolName) return;

  const methods = getMergedMethods(studio);
  const method = methods.find(m => m.name === selectedToolName);
  if (!method) return;

  const schema = method.inputSchema || { type: 'object', properties: {} };
  const properties = schema.properties || {};
  const required = schema.required || [];
  const propEntries = Object.entries(properties);

  let html = '';

  // Description
  if (method.description) {
    html += '<div class="field-desc" style="margin-bottom:12px;color:#888;font-size:0.85rem">' +
      escapeHtml(method.description) + '</div>';
  }

  // Target selector (play mode)
  if (studio.gameState === 'play' && method.target && method.target.length > 0) {
    html += '<div class="target-selector">' +
      '<label>Target:</label>' +
      '<select id="targetSelect">' +
      method.target.map(t => '<option value="' + t + '">' + t + '</option>').join('') +
      '</select></div>';
  }

  // Form fields from inputSchema
  if (propEntries.length === 0) {
    html += '<div class="empty-state" style="padding:10px">No parameters</div>';
  } else {
    for (const [name, prop] of propEntries) {
      const isRequired = required.includes(name);
      html += renderFormField(name, prop, isRequired);
    }
  }

  // Submit button
  html += '<div class="form-actions">' +
    '<button class="btn-primary" id="executeBtn">Execute</button></div>';

  toolForm.innerHTML = html;

  // Bind execute
  document.getElementById('executeBtn').addEventListener('click', executeSelectedTool);

  // Tool web iframe
  updateToolWebIframe(method);
}

// Render a single form field from JSON Schema property
function renderFormField(name, prop, isRequired) {
  const label = name + (isRequired ? ' *' : '');
  const desc = prop.description || '';
  let input = '';

  if (prop.type === 'string' && prop.enum) {
    // Enum → select
    input = '<select id="field_' + name + '">' +
      prop.enum.map(v => '<option value="' + escapeHtml(v) + '">' + escapeHtml(v) + '</option>').join('') +
      '</select>';
  } else if (prop.type === 'string' && prop['x-file']) {
    // x-file → textarea (file:// URI or content)
    input = '<textarea id="field_' + name + '" rows="6" placeholder="Enter code or file:// path"></textarea>';
  } else if (prop.type === 'string') {
    // Plain string → input or textarea for long text
    input = '<input type="text" id="field_' + name + '" placeholder="' + escapeHtml(desc) + '">';
  } else if (prop.type === 'number' || prop.type === 'integer') {
    const defaultVal = prop.default !== undefined ? prop.default : '';
    input = '<input type="number" id="field_' + name + '" value="' + defaultVal + '">';
  } else if (prop.type === 'boolean') {
    const checked = prop.default ? ' checked' : '';
    input = '<label style="display:flex;align-items:center;gap:6px">' +
      '<input type="checkbox" id="field_' + name + '"' + checked + '> ' + escapeHtml(desc || name) + '</label>';
  } else if (prop.type === 'object') {
    input = '<textarea id="field_' + name + '" rows="4" placeholder="JSON">{}</textarea>';
  } else {
    input = '<input type="text" id="field_' + name + '">';
  }

  return '<div class="form-field">' +
    '<label for="field_' + name + '">' + escapeHtml(label) + '</label>' +
    (desc && prop.type !== 'boolean' ? '<div class="field-desc">' + escapeHtml(desc) + '</div>' : '') +
    input + '</div>';
}

// Collect form values
function collectFormValues() {
  const studio = getSelectedStudio();
  if (!studio || !selectedToolName) return null;

  const methods = getMergedMethods(studio);
  const method = methods.find(m => m.name === selectedToolName);
  if (!method) return null;

  const schema = method.inputSchema || { type: 'object', properties: {} };
  const properties = schema.properties || {};
  const params = {};

  for (const [name, prop] of Object.entries(properties)) {
    const el = document.getElementById('field_' + name);
    if (!el) continue;

    if (prop.type === 'boolean') {
      params[name] = el.checked;
    } else if (prop.type === 'number' || prop.type === 'integer') {
      const val = el.value.trim();
      if (val !== '') params[name] = Number(val);
    } else if (prop.type === 'object') {
      try {
        params[name] = JSON.parse(el.value);
      } catch (e) {
        params[name] = el.value;
      }
    } else {
      const val = el.value.trim();
      if (val !== '') params[name] = val;
    }
  }

  // Target
  const targetEl = document.getElementById('targetSelect');
  if (targetEl) {
    params.target = targetEl.value;
  }

  return params;
}

// Execute selected tool
async function executeSelectedTool() {
  if (!selectedStudioId || !selectedToolName) return;

  const params = collectFormValues();
  const executeBtn = document.getElementById('executeBtn');
  executeBtn.disabled = true;
  executeBtn.textContent = 'Executing...';
  showResult('Executing...', false);

  try {
    const res = await fetch(API_BASE + '/api/studios/' + encodeURIComponent(selectedStudioId) + '/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: selectedToolName, params: params, timeout: 30 }),
    });

    const data = await res.json();

    if (res.ok && data.success) {
      let output = 'Success\n';
      if (data.result !== undefined && data.result !== null) {
        output += '\nResult: ' + JSON.stringify(data.result, null, 2);
      }
      if (data.logs && data.logs.server && data.logs.server.length) {
        output += '\n\nLogs:\n' + data.logs.server.join('\n');
      }
      showResult(output, false);
    } else {
      let errorMsg = 'Failed\n';
      if (data.error) errorMsg += '\n' + data.error;
      if (data.errors) {
        if (data.errors.server) errorMsg += '\nServer: ' + data.errors.server;
        if (data.errors.client) errorMsg += '\nClient: ' + data.errors.client;
      }
      showResult(errorMsg, true);
    }
  } catch (e) {
    showResult('Request failed: ' + e.message, true);
  } finally {
    executeBtn.disabled = false;
    executeBtn.textContent = 'Execute';
  }
}

// Update tool web iframe
function updateToolWebIframe(method) {
  // Find plugin tool info for web path
  const pluginTool = pluginToolsCache.find(t => t.name === method.name);
  const webPath = method.web || (pluginTool && pluginTool.web);

  if (webPath) {
    // Construct full URL from plugin mount path
    // web paths like "/tools/entities" are relative to plugin's mount path
    // We need the plugin name to build /plugins/<name><webPath>
    // For now, use the web path directly if it starts with /
    toolWebIframe.src = webPath;
    toolWebSection.style.display = '';
  } else {
    toolWebSection.style.display = 'none';
    toolWebIframe.src = 'about:blank';
  }
}

// Show result
function showResult(text, isError) {
  resultBox.textContent = text;
  resultBox.className = 'result-box' + (isError ? ' error' : ' success');
}

function updateHubStatus(online, text) {
  const dot = hubStatus.querySelector('.dot');
  const span = hubStatus.querySelector('span:last-child');

  if (online) {
    dot.className = 'dot online';
    span.textContent = text || 'Connected';
  } else {
    dot.className = 'dot offline';
    span.textContent = text || 'Disconnected';
  }
}

// Utilities
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatTime(isoString) {
  const date = new Date(isoString);
  return date.toLocaleTimeString();
}
