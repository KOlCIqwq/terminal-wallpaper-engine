// --- Settings & Background Manager Widget ---
let currentBgVideo = "";
let currentBgImage = "";
window.currentBgDim = 0.6;
let currentBgType = "image";

let bgPosX = parseInt(localStorage.getItem('bg_pos_x') || '50', 10);
let bgPosY = parseInt(localStorage.getItem('bg_pos_y') || '50', 10);

function updateBgPositionDisplay() {
    document.documentElement.style.setProperty('--bg-pos-x', bgPosX + '%');
    document.documentElement.style.setProperty('--bg-pos-y', bgPosY + '%');
    const labelX = document.getElementById('label-bg-x');
    const labelY = document.getElementById('label-bg-y');
    if (labelX) labelX.textContent = bgPosX + '%';
    if (labelY) labelY.textContent = bgPosY + '%';
}
window.updateBgPositionDisplay = updateBgPositionDisplay;
updateBgPositionDisplay();

let pendingWebmPath = null;
window.pendingWebmPath = pendingWebmPath;

const widgetSettings = document.getElementById('widget-settings');
const btnSettings = document.getElementById('btn-settings');
const btnCloseSettings = document.getElementById('btn-close-settings');
const toggleBgVideo = document.getElementById('toggle-bg-video');
const togglePixivBg = document.getElementById('toggle-pixiv-bg');
const settingsDimLabel = document.getElementById('settings-dim-label');

let bgVideoEnabled = localStorage.getItem('bg_video_enabled') !== 'false';

if (btnSettings && widgetSettings) {
    btnSettings.addEventListener('click', (e) => {
        e.stopPropagation();
        widgetSettings.style.display = widgetSettings.style.display === 'none' ? 'block' : 'none';
        
        const launcherRect = document.getElementById('widget-settings-launcher').getBoundingClientRect();
        widgetSettings.style.left = (launcherRect.left) + "px";
        widgetSettings.style.top = (launcherRect.top + 50) + "px";
        
        if (toggleBgVideo) toggleBgVideo.textContent = bgVideoEnabled ? "[ ENABLED ]" : "[ DISABLED ]";
        if (togglePixivBg) togglePixivBg.textContent = window.pixivEnabled ? "[ ENABLED ]" : "[ DISABLED ]";
        if (settingsDimLabel) settingsDimLabel.textContent = Math.round(window.currentBgDim * 100) + "%";
        updateBgPositionDisplay();
    });
}

if (btnCloseSettings && widgetSettings) {
    btnCloseSettings.addEventListener('click', () => {
        widgetSettings.style.display = 'none';
    });
}

if (toggleBgVideo) {
    toggleBgVideo.addEventListener('click', () => {
        bgVideoEnabled = !bgVideoEnabled;
        localStorage.setItem('bg_video_enabled', bgVideoEnabled);
        toggleBgVideo.textContent = bgVideoEnabled ? "[ ENABLED ]" : "[ DISABLED ]";
        refreshBackground();
    });
}

if (togglePixivBg) {
    togglePixivBg.addEventListener('click', () => {
        window.pixivEnabled = !window.pixivEnabled;
        if (typeof updatePixivUI === 'function') {
            updatePixivUI();
        } else {
            togglePixivBg.textContent = window.pixivEnabled ? "[ ENABLED ]" : "[ DISABLED ]";
        }
        
        if (window.pixivEnabled) {
            if (typeof fetchPixivRanking === 'function') {
                if (window.pixivRankings && window.pixivRankings.length > 0) {
                    if (typeof applyPixivBackground === 'function') applyPixivBackground();
                } else {
                    fetchPixivRanking();
                }
            }
        } else {
            if (typeof cancelPixivLoading === 'function') cancelPixivLoading();
            const btnNext = document.getElementById('btn-pixiv-next');
            if (btnNext) btnNext.style.display = 'none';
            refreshBackground();
        }
    });
}

// Background Position Offset Buttons
const btnBgXDown = document.getElementById('btn-bg-x-down');
const btnBgXUp = document.getElementById('btn-bg-x-up');
const btnBgYDown = document.getElementById('btn-bg-y-down');
const btnBgYUp = document.getElementById('btn-bg-y-up');
const btnBgResetPos = document.getElementById('btn-bg-reset-pos');

if (btnBgXDown) {
    btnBgXDown.addEventListener('click', (e) => {
        e.stopPropagation();
        bgPosX = Math.max(-500, bgPosX - 5);
        localStorage.setItem('bg_pos_x', bgPosX);
        updateBgPositionDisplay();
    });
}
if (btnBgXUp) {
    btnBgXUp.addEventListener('click', (e) => {
        e.stopPropagation();
        bgPosX = Math.min(500, bgPosX + 5);
        localStorage.setItem('bg_pos_x', bgPosX);
        updateBgPositionDisplay();
    });
}
if (btnBgYDown) {
    btnBgYDown.addEventListener('click', (e) => {
        e.stopPropagation();
        bgPosY = Math.max(-500, bgPosY - 5);
        localStorage.setItem('bg_pos_y', bgPosY);
        updateBgPositionDisplay();
    });
}
if (btnBgYUp) {
    btnBgYUp.addEventListener('click', (e) => {
        e.stopPropagation();
        bgPosY = Math.min(500, bgPosY + 5);
        localStorage.setItem('bg_pos_y', bgPosY);
        updateBgPositionDisplay();
    });
}
if (btnBgResetPos) {
    btnBgResetPos.addEventListener('click', (e) => {
        e.stopPropagation();
        bgPosX = 50;
        bgPosY = 50;
        localStorage.setItem('bg_pos_x', 50);
        localStorage.setItem('bg_pos_y', 50);
        updateBgPositionDisplay();
    });
}

// Custom Background Browse
const btnBrowseBg = document.getElementById('btn-browse-mp4');
if (btnBrowseBg) {
    btnBrowseBg.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof appendLog === 'function') appendLog("[BROWSER] Opening file dialog...");
        fetch('http://127.0.0.1:25555/media/browse')
            .then(res => res.json())
            .then(data => {
                if (data.status === 'success') {
                    localStorage.setItem('custom_bg_path', data.path);
                    applyCustomBackground(data.path);
                }
            })
            .catch(err => { if (typeof appendLog === 'function') appendLog("[BROWSER] Python server offline."); });
    });
}

function refreshBackground() {
    const savedBg = localStorage.getItem('custom_bg_path');
    if (savedBg) {
        applyCustomBackground(savedBg);
    } else if (window.wallpaperPropertyListener && window.wallpaperPropertyListener.applyUserProperties) {
        window.wallpaperPropertyListener.applyUserProperties(window.lastWeProperties || {});
    }
}
window.refreshBackground = refreshBackground;

function applyCustomBackground(path) {
    if (!path) return;
    if (window.pixivEnabled) {
        if (typeof appendLog === 'function') appendLog("[BROWSER] Disable Pixiv first to use custom background.");
        return;
    }

    window.customBgActive = true;
    const videoLayer = document.getElementById('bg-layer-video');
    const imageLayer = document.getElementById('bg-layer-image');
    const overlayLayer = document.getElementById('bg-layer-overlay');
    const isVideo = path.match(/\.(mp4|webm|ogg|mov|avi|mkv)$/i);
    const isMp4 = path.match(/\.(mp4|mov|m4v|avi|mkv)$/i);
    
    const isLocal = path === 'background.webm';
    const finalUrl = isLocal ? (path + '?t=' + Date.now()) : `http://127.0.0.1:25555/video_proxy?path=${encodeURIComponent(path)}&t=${Date.now()}`;

    document.body.style.backgroundColor = 'transparent';
    document.body.style.backgroundImage = 'none';

    if (isVideo) {
        if (isMp4) {
            if (typeof appendLog === 'function') appendLog("[BROWSER] MP4 detected. Starting auto-conversion to Local WebM...");
            pendingWebmPath = 'background.webm';
            window.pendingWebmPath = pendingWebmPath;
            fetch(`http://127.0.0.1:25555/media/convert?path=${encodeURIComponent(path)}`).catch(e => console.log(e));
            return; 
        }
        if (imageLayer) imageLayer.style.display = 'none';
        
        videoLayer.pause();
        videoLayer.removeAttribute('src');
        videoLayer.load();
        
        videoLayer.style.display = 'block';
        videoLayer.src = finalUrl;
        
        videoLayer.oncanplay = () => {
            videoLayer.play().catch(e => console.log("Play Error:", e));
        };

        videoLayer.onerror = () => {
            const err = videoLayer.error;
            let msg = `[BROWSER] Video Error: ${err ? err.code : 'unknown'}`;
            if (err && err.code === 4) {
                msg += " (Incompatible codec or file busy. Try converting again!)";
            }
            if (typeof appendLog === 'function') appendLog(msg);
        };
    } else {
        if (videoLayer) {
            videoLayer.style.display = 'none';
            videoLayer.pause();
            videoLayer.removeAttribute('src');
            videoLayer.load();
        }
        if (imageLayer) {
            imageLayer.style.backgroundImage = `url('${finalUrl}')`;
            imageLayer.style.display = 'block';
            if (typeof appendLog === 'function') appendLog(`[BROWSER] Image Applied: ${path.split('\\').pop()}`);
        }
    }
    
    if (overlayLayer) {
        overlayLayer.style.backgroundColor = `rgba(0, 0, 0, ${window.currentBgDim})`;
        overlayLayer.style.display = 'block';
    }
}
window.applyCustomBackground = applyCustomBackground;

function checkServerAndLoad() {
    const localWebmPath = 'background.webm';
    fetch(localWebmPath, { method: 'HEAD' })
        .then(res => {
            if (res.ok) {
                console.log("[STARTUP] Local background.webm found, playing...");
                if (!window.pixivEnabled) applyCustomBackground(localWebmPath);
            } else {
                const savedBg = localStorage.getItem('custom_bg_path');
                if (!savedBg) return;

                if (window.isPythonServerRunning) {
                    console.log("[STARTUP] Server ready, applying saved background...");
                    if (!window.pixivEnabled) applyCustomBackground(savedBg);
                } else {
                    setTimeout(checkServerAndLoad, 1000);
                }
            }
        })
        .catch(() => {
            const savedBg = localStorage.getItem('custom_bg_path');
            if (savedBg && window.isPythonServerRunning) {
                if (!window.pixivEnabled) applyCustomBackground(savedBg);
            } else if (savedBg) {
                setTimeout(checkServerAndLoad, 1000);
            }
        });
}

checkServerAndLoad();

window.myPropertyHandlers = window.myPropertyHandlers || [];
window.myPropertyHandlers.push(function(properties) {
    const root = document.documentElement;

    if (properties.bg_type !== undefined) {
        currentBgType = properties.bg_type.value;
    }
    if (properties.bg_image !== undefined) {
        currentBgImage = properties.bg_image.value ? String(properties.bg_image.value) : "";
    }
    if (properties.bg_video !== undefined) {
        currentBgVideo = properties.bg_video.value ? String(properties.bg_video.value).trim() : "";
    }
    if (properties.bg_dim !== undefined) {
        window.currentBgDim = properties.bg_dim.value / 100;
    }
    if (properties.bg_pos_x !== undefined) {
        bgPosX = properties.bg_pos_x.value;
        localStorage.setItem('bg_pos_x', bgPosX);
        updateBgPositionDisplay();
    }
    if (properties.bg_pos_y !== undefined) {
        bgPosY = properties.bg_pos_y.value;
        localStorage.setItem('bg_pos_y', bgPosY);
        updateBgPositionDisplay();
    }

    const imageLayer = document.getElementById('bg-layer-image');
    const videoLayer = document.getElementById('bg-layer-video');
    const overlayLayer = document.getElementById('bg-layer-overlay');

    let vPath = currentBgVideo === "null" ? "" : currentBgVideo;
    let iPath = currentBgImage === "null" ? "" : currentBgImage;

    if (window.customBgActive) {
        if (overlayLayer) {
            overlayLayer.style.backgroundColor = `rgba(0, 0, 0, ${window.currentBgDim})`;
            overlayLayer.style.display = 'block';
        }
        return;
    }

    let isValidVideo = vPath !== "" && vPath.match(/\.(mp4|webm|ogg|mov|avi|mkv)$/i) !== null;

    if (isValidVideo && currentBgType === "video" && vPath !== "" && !window.pixivEnabled) {
        if (overlayLayer) {
            overlayLayer.style.backgroundColor = `rgba(0, 0, 0, ${window.currentBgDim})`;
            overlayLayer.style.display = 'block';
        }
        if (imageLayer) imageLayer.style.display = 'none';
        
        let safePath = vPath.replace(/\\/g, '/');
        let finalUrl = safePath.includes(':/') ? 'file:///' + safePath : safePath;
        
        if (videoLayer.getAttribute('src') !== finalUrl) {
            videoLayer.setAttribute('src', finalUrl);
        }

        if (bgVideoEnabled) {
            videoLayer.style.display = 'block';
            videoLayer.muted = true;
            videoLayer.loop = true;
            if (videoLayer.paused) {
                videoLayer.play().catch(err => console.log("Video Play Error:", err));
            }
        } else {
            videoLayer.style.display = 'none';
            videoLayer.pause();
        }
        document.body.style.backgroundImage = 'none'; 
    } else if (currentBgType === "image" && iPath !== "" && !window.pixivEnabled) {
        if (videoLayer) {
            videoLayer.style.display = 'none';
            videoLayer.removeAttribute('src'); 
            videoLayer.load(); 
        }
        let safePath = iPath.replace(/\\/g, '/');
        if (imageLayer) {
            imageLayer.style.backgroundImage = `url('file:///${safePath}')`;
            imageLayer.style.display = 'block';
        }
        if (overlayLayer) {
            overlayLayer.style.backgroundColor = `rgba(0, 0, 0, ${window.currentBgDim})`;
            overlayLayer.style.display = 'block';
        }
        document.body.style.backgroundImage = 'none';
    } else if (!window.pixivEnabled) {
        if (videoLayer) {
            videoLayer.style.display = 'none';
            videoLayer.removeAttribute('src');
            videoLayer.load();
        }
        if (imageLayer) imageLayer.style.display = 'none';
        if (overlayLayer) overlayLayer.style.display = 'none';
        document.body.style.backgroundImage = 'none';
    }

    if (properties.mp4_path) {
        let val = properties.mp4_path.value.trim();
        if (val !== "") {
            fetch(`http://127.0.0.1:25555/media/convert?path=${encodeURIComponent(val)}`)
                .then(res => res.json())
                .then(data => {
                    if (data.status === "started") {
                        if (typeof appendLog === 'function') appendLog(`[CONVERTER] Started. Look for ${data.output} soon.`);
                    }
                })
                .catch(err => { if (typeof appendLog === 'function') appendLog("[CONVERTER] Error contacting server."); });
        }
    }
});
