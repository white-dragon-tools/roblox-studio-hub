// Roblox Studio Hub - Web UI (HTTP Polling)

const API_BASE = '';
let autoScroll = true;
let pollTimer = null;
let lastEventTimestamp = 0;
let selectedStudioId = null;
let selectedMode = 'eval';

// DOM Elements
const hubStatus = document.getElementById('hubStatus');
const studiosList = document.getElementById('studiosList');
const executeMode = document.getElementById('executeMode');
const codeInput = document.getElementById('codeInput');
const executeBtn = document.getElementById('executeBtn');
const resultBox = document.getElementById('resultBox');
const logsBox = document.getElementById('logsBox');
const autoScrollCheckbox = document.getElementById('autoScroll');
const clearLogsBtn = document.getElementById('clearLogs');

// Studios cache
let studiosCache = [];

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  initUI();
  
  // Event listeners
  executeBtn.addEventListener('click', executeCode);
  clearLogsBtn.addEventListener('click', clearLogs);
  autoScrollCheckbox.addEventListener('change', (e) => {
    autoScroll = e.target.checked;
  });
  
  // Mode buttons
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedMode = btn.dataset.mode;
    });
  });
});

// Initialize UI and start polling
async function initUI() {
  updateHubStatus(false, '连接中...');
  
  try {
    // Fetch initial data
    const res = await fetch(`${API_BASE}/api/ui/init`);
    if (!res.ok) throw new Error('Failed to fetch init data');
    
    const data = await res.json();
    studiosCache = data.studios || [];
    renderStudios(studiosCache);
    updateHubStatus(true);
    
    // Start polling
    startPolling();
  } catch (e) {
    console.error('[UI] Init failed:', e);
    updateHubStatus(false, '连接失败');
    
    // Retry after 3 seconds
    setTimeout(initUI, 3000);
  }
}

// Start long polling for updates
function startPolling() {
  if (pollTimer) {
    clearTimeout(pollTimer);
  }
  
  poll();
}

async function poll() {
  try {
    const res = await fetch(`${API_BASE}/api/ui/poll?since=${lastEventTimestamp}&timeout=30`);
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
    
    // Continue polling immediately
    pollTimer = setTimeout(poll, 0);
  } catch (e) {
    console.error('[UI] Poll error:', e);
    updateHubStatus(false, '连接断开');
    
    // Retry after 3 seconds
    pollTimer = setTimeout(() => {
      updateHubStatus(false, '重连中...');
      initUI();
    }, 3000);
  }
}

// Handle events from server
function handleEvent(event) {
  updateHubStatus(true);
  
  switch (event.type) {
    case 'studio_connected':
      // New studio connected - remove any existing with same ID first
      const studio = event.data.studio;
      studiosCache = studiosCache.filter(s => s.id !== studio.id);
      studiosCache.push(studio);
      renderStudios(studiosCache);
      addSystemLog(`Studio 已连接: ${studio.placeName}`);
      break;
    
    case 'studio_disconnected':
      // Studio disconnected
      const disconnectedId = event.data.studioId;
      const disconnected = studiosCache.find(s => s.id === disconnectedId);
      studiosCache = studiosCache.filter(s => s.id !== disconnectedId);
      
      // 如果断开的是当前选中的，清除选中
      if (selectedStudioId === disconnectedId) {
        selectedStudioId = null;
      }
      
      renderStudios(studiosCache);
      addSystemLog(`Studio 已断开: ${disconnected?.placeName || disconnectedId}`);
      break;
    
    default:
      console.log('[UI] Unknown event type:', event.type);
  }
}

// Render studios list
function renderStudios(studios) {
  // 确保有选中项（默认第一个）
  if (studios.length > 0) {
    if (!selectedStudioId || !studios.some(s => s.id === selectedStudioId)) {
      selectedStudioId = studios[0].id;
    }
  } else {
    selectedStudioId = null;
  }
  
  if (studios.length === 0) {
    studiosList.innerHTML = '<div class="empty-state">暂无连接</div>';
    return;
  }
  
  studiosList.innerHTML = studios.map(s => {
    // 构建显示名称和元信息
    let displayName = escapeHtml(s.placeName);
    let metaInfo = formatTime(s.connectedAt);
    
    if (s.type === 'place') {
      // 云场景：显示更多信息
      let metaParts = [];
      if (s.creatorName) {
        metaParts.push(`by ${s.creatorType === 'Group' ? '👥' : '👤'} ${s.creatorName}`);
      }
      metaParts.push(`Place: ${s.placeId}`);
      metaInfo = metaParts.join(' | ');
    } else if (s.localPath) {
      // 本地模式且有 localPath
      metaInfo = escapeHtml(s.localPath);
    }
    
    return `
      <div class="studio-card${s.id === selectedStudioId ? ' selected' : ''}" data-id="${s.id}">
        <div class="studio-info">
          <div class="studio-name">${displayName}</div>
          <div class="studio-meta">${metaInfo}</div>
        </div>
        <span class="studio-type ${s.type}">${s.type === 'place' ? '☁️' : '📁'}</span>
      </div>
    `;
  }).join('');
  
  // 点击卡片选中
  studiosList.querySelectorAll('.studio-card').forEach(card => {
    card.addEventListener('click', () => {
      selectedStudioId = card.dataset.id;
      renderStudios(studiosCache);
    });
  });
}

// Execute code
async function executeCode() {
  const code = codeInput.value.trim();
  
  if (!selectedStudioId) {
    showResult('请在左侧选择目标 Studio', true);
    return;
  }
  
  if (!code) {
    showResult('请输入代码', true);
    return;
  }
  
  executeBtn.disabled = true;
  executeBtn.textContent = '执行中...';
  showResult('执行中...', false);
  
  try {
    const res = await fetch(`${API_BASE}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studioId: selectedStudioId, code, mode: selectedMode, timeout: 30 })
    });
    
    const data = await res.json();
    
    if (data.success) {
      let output = '✅ 执行成功\n';
      
      // Handle result (could be object with server/client or single value)
      if (data.result !== undefined && data.result !== null) {
        if (typeof data.result === 'object' && (data.result.server !== undefined || data.result.client !== undefined)) {
          // Play mode with server/client results
          if (data.result.server !== undefined) {
            output += `\n🖥️ 服务端返回值: ${JSON.stringify(data.result.server, null, 2)}`;
          }
          if (data.result.client !== undefined) {
            output += `\n💻 客户端返回值: ${JSON.stringify(data.result.client, null, 2)}`;
          }
        } else {
          output += `\n返回值: ${JSON.stringify(data.result, null, 2)}`;
        }
      }
      
      // Logs
      if (data.logs?.server?.length) {
        output += `\n\n📋 日志:\n${data.logs.server.join('\n')}`;
      }
      
      if (!data.result && (!data.logs?.server?.length) && (!data.logs?.client?.length)) {
        output += '\n(无返回值和输出)';
      }
      showResult(output, false);
    } else {
      let errorMsg = `❌ 执行失败\n`;
      if (data.error) {
        errorMsg += `\n${data.error}`;
      }
      if (data.errors?.server) {
        errorMsg += `\n\n🖥️ 服务端错误: ${data.errors.server}`;
      }
      if (data.errors?.client) {
        errorMsg += `\n\n💻 客户端错误: ${data.errors.client}`;
      }
      if (data.logs?.server?.length) {
        errorMsg += `\n\n📋 日志:\n${data.logs.server.join('\n')}`;
      }
      showResult(errorMsg, true);
    }
  } catch (e) {
    showResult(`❌ 请求失败: ${e.message}`, true);
  } finally {
    executeBtn.disabled = false;
    executeBtn.textContent = '执行 ▶';
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
    span.textContent = text || '已连接';
  } else {
    dot.className = 'dot offline';
    span.textContent = text || '未连接';
  }
}

// Add system log entry
function addSystemLog(message) {
  const entry = document.createElement('div');
  entry.className = 'log-entry system';
  
  const time = new Date().toLocaleTimeString();
  entry.innerHTML = `
    <span class="time">[${time}]</span>
    <span class="studio">[系统]</span>
    <span class="message">${escapeHtml(message)}</span>
  `;
  
  logsBox.appendChild(entry);
  
  if (autoScroll) {
    logsBox.scrollTop = logsBox.scrollHeight;
  }
}

// Clear logs
function clearLogs() {
  logsBox.innerHTML = '';
}

// Utility functions
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatTime(isoString) {
  const date = new Date(isoString);
  return date.toLocaleTimeString();
}
