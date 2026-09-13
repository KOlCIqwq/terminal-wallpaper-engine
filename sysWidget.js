// --- System Monitor Widget Logic ---
const CACHE_KEY = "specs";
const overrides = {
    os: false,
    cpu: false,
    gpu: false,
    ram: false,
    disk: false,
    username: false,
    log: false
};

const fallbackData = {
    os: "Detecting OS...",
    cpu_name: "Loading CPU...",
    gpu_name: "Loading GPU...",
    ram_total: "0.0 GB",
    disk_total: "0.0 GB",
    cpu_percent: 5,
    gpu_percent: 2,
    ram_percent: 45,
    disk_percent: 60
};

let customLogText = "";
let lastSysLogStr = "";
let isPythonServerRunning = true;

window.isPythonServerRunning = isPythonServerRunning;
window.overrides = overrides;
window.fallbackData = fallbackData;

function generateAsciiBar(percent, totalLength = 20) {
    const clampedPercent = Math.max(0, Math.min(100, percent));
    const filledCount = Math.round((clampedPercent / 100) * totalLength);
    const emptyCount = totalLength - filledCount;
    
    const charFilled = window.charFilled || '|';
    const charEmpty = window.charEmpty || '·';

    const filledStr = charFilled.repeat(filledCount);
    const emptyStr = charEmpty.repeat(emptyCount);
    
    return `[${filledStr}<span class="gray">${emptyStr}</span>]`;
}
window.generateAsciiBar = generateAsciiBar;

function updateHardwareUI(data, isLive) {
    if (data.os && !overrides.os) {
        const el = document.getElementById('os');
        if (el) el.textContent = data.os;
    }
    if (data.cpu_name && !overrides.cpu) {
        const el = document.getElementById('cpu');
        if (el) el.textContent = data.cpu_name;
    }
    if (data.gpu_name && !overrides.gpu) {
        const el = document.getElementById('gpu');
        if (el) el.textContent = data.gpu_name;
    }
    if (data.ram_total && !overrides.ram) {
        const el = document.getElementById('ram');
        if (el) el.textContent = data.ram_total;
    }
    if (data.disk_total && !overrides.disk) {
        const el = document.getElementById('disk');
        if (el) el.textContent = data.disk_total;
    }

    if (data.cpu_percent !== undefined) {
        const bar = generateAsciiBar(data.cpu_percent);
        const el = document.getElementById('cpu-bar');
        if (el) el.innerHTML = `${bar} ${data.cpu_percent}%`;
    }
    if (data.gpu_percent !== undefined) {
        const bar = generateAsciiBar(data.gpu_percent);
        const el = document.getElementById('gpu-bar');
        if (el) el.innerHTML = `${bar} ${data.gpu_percent}%`;
    }
    if (data.ram_percent !== undefined) {
        const bar = generateAsciiBar(data.ram_percent);
        const extra = (isLive && data.ram_used !== undefined) ? ` <span class="white">(${data.ram_used} GB)</span>` : "";
        const el = document.getElementById('ram-bar');
        if (el) el.innerHTML = `${bar} ${data.ram_percent}%${extra}`;
    }
    if (data.disk_percent !== undefined) {
        const bar = generateAsciiBar(data.disk_percent);
        const extra = (isLive && data.disk_used !== undefined) ? ` <span class="white">(${data.disk_used} / ${data.disk_total})</span>` : "";
        const el = document.getElementById('disk-bar');
        if (el) el.innerHTML = `${bar} ${data.disk_percent}%${extra}`;
    }
}
window.updateHardwareUI = updateHardwareUI;

function loadCachedSpecs() {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
        try {
            const data = JSON.parse(cached);
            if (data.os) { 
                fallbackData.os = data.os; 
                if (!overrides.os) { const el = document.getElementById('os'); if (el) el.textContent = data.os; }
            }
            if (data.cpu_name) { 
                fallbackData.cpu_name = data.cpu_name; 
                if (!overrides.cpu) { const el = document.getElementById('cpu'); if (el) el.textContent = data.cpu_name; }
            }
            if (data.gpu_name) { 
                fallbackData.gpu_name = data.gpu_name; 
                if (!overrides.gpu) { const el = document.getElementById('gpu'); if (el) el.textContent = data.gpu_name; }
            }
            if (data.ram_total) { 
                fallbackData.ram_total = data.ram_total; 
                if (!overrides.ram) { const el = document.getElementById('ram'); if (el) el.textContent = data.ram_total; }
            }
            if (data.disk_total) { 
                fallbackData.disk_total = data.disk_total; 
                if (!overrides.disk) { const el = document.getElementById('disk'); if (el) el.textContent = data.disk_total; }
            }
        } catch (e) {
            localStorage.removeItem(CACHE_KEY);
        }
    }
}

function fetchSystemSpecs() {
    fetch('http://127.0.0.1:25555/specs')
        .then(response => {
            if (!response.ok) throw new Error("Server down");
            return response.json();
        })
        .then(data => {
            try {
                if (!isPythonServerRunning) {
                    console.log("Python Server Reconnected!");
                    isPythonServerRunning = true;
                    window.isPythonServerRunning = true;
                    const logEl = document.getElementById('log_text');
                    if (logEl) logEl.textContent = overrides.log ? customLogText : "";
                }

                updateHardwareUI(data, true);

                // Media volume fallback if WS is not driving it
                if (data.sys_volume !== undefined && typeof window.renderVolumeBar === 'function' && !window.isDraggingVolume) {
                    if (Date.now() - (window.lastVolumeSetTime || 0) > 1500) {
                        window.renderVolumeBar(data.sys_volume);
                    }
                }

                if (data.sys_log && data.sys_log !== lastSysLogStr) {
                    lastSysLogStr = data.sys_log;
                    if (typeof appendLog === 'function') appendLog(`[MONITOR] ${data.sys_log}`);
                }

                // Handle conversion progress
                if (data.conv_progress !== undefined && data.conv_progress >= 0) {
                    const logElement = document.getElementById('log_text');
                    if (logElement && !overrides.log) {
                        logElement.textContent = `[CONVERTING] ${data.conv_progress}%`;
                    }
                    if (data.conv_progress === 100 && window.pendingWebmPath) {
                        const pathToApply = window.pendingWebmPath;
                        window.pendingWebmPath = null;
                        localStorage.setItem('custom_bg_path', pathToApply);
                        if (typeof applyCustomBackground === 'function') {
                            setTimeout(() => applyCustomBackground(pathToApply), 500);
                        }
                    }
                }

                // Fallback timeline if WebSocket is not connected
                if (!window.isWsConnected && typeof window.handleHttpMediaFallback === 'function') {
                    window.handleHttpMediaFallback(data);
                }

                const dataToSave = {
                    os: data.os,
                    cpu_name: data.cpu_name,
                    gpu_name: data.gpu_name,
                    ram_total: data.ram_total,
                    disk_total: data.disk_total
                };
                localStorage.setItem(CACHE_KEY, JSON.stringify(dataToSave));
            } catch (uiError) {
                console.error("[UI Error] Formatting failed:", uiError);
            }

            setTimeout(fetchSystemSpecs, 250);
        })
        .catch(err => {
            isPythonServerRunning = false;
            window.isPythonServerRunning = false;
            updateHardwareUI(fallbackData, false);
            
            const logElement = document.getElementById('log_text');
            if (logElement) logElement.textContent = "[ Native Mode Active ]";

            setTimeout(fetchSystemSpecs, 5000);
        });
}

// Initial load
loadCachedSpecs();
fetchSystemSpecs();

window.myPropertyHandlers = window.myPropertyHandlers || [];
window.myPropertyHandlers.push(function(properties) {
    if (properties.username) {
        const value = properties.username.value.trim();
        overrides.username = value !== "";
        const el = document.getElementById('username');
        if (el) el.textContent = overrides.username ? value : "user@System";
    }

    if (properties.log) {
        const value = properties.log.value.trim();
        overrides.log = value !== "";
        customLogText = value;
        const el = document.getElementById('log_text');
        if (el) el.textContent = overrides.log ? value : "";
    } 

    if (properties.custom_os) {
        const value = properties.custom_os.value.trim();
        overrides.os = value !== "";
        const el = document.getElementById('os');
        if (el) el.textContent = overrides.os ? value : fallbackData.os;
    }

    if (properties.custom_cpu) {
        const value = properties.custom_cpu.value.trim();
        overrides.cpu = value !== "";
        const el = document.getElementById('cpu');
        if (el) el.textContent = overrides.cpu ? value : fallbackData.cpu_name;
    }

    if (properties.custom_gpu) {
        const value = properties.custom_gpu.value.trim();
        overrides.gpu = value !== "";
        const el = document.getElementById('gpu');
        if (el) el.textContent = overrides.gpu ? value : fallbackData.gpu_name;
    }

    if (properties.custom_ram) {
        const value = properties.custom_ram.value.trim();
        overrides.ram = value !== "";
        const el = document.getElementById('ram');
        if (el) el.textContent = overrides.ram ? value : fallbackData.ram_total;
    }

    if (properties.custom_disk) {
        const value = properties.custom_disk.value.trim();
        overrides.disk = value !== "";
        const el = document.getElementById('disk');
        if (el) el.textContent = overrides.disk ? value : fallbackData.disk_total;
    }

    if (properties.fake_cpu) fallbackData.cpu_percent = properties.fake_cpu.value;
    if (properties.fake_gpu) fallbackData.gpu_percent = properties.fake_gpu.value;
    if (properties.fake_ram) fallbackData.ram_percent = properties.fake_ram.value;
    if (properties.fake_disk) fallbackData.disk_percent = properties.fake_disk.value;

    if (!isPythonServerRunning) {
        updateHardwareUI(fallbackData, false);
    }
});

