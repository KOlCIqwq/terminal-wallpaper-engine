// --- Media Player Widget Logic ---
let lastSeekTime = 0;
let optimisticPosition = 0;
let optimisticStatus = null;
let lastPlayPauseTime = 0;
let currentMediaPosition = 0;

let wsMedia = null;
let isWsConnected = false;
let mediaBasePos = 0;
let mediaBaseTime = 0;
let mediaStatus = "Stopped";
let mediaDuration = 0;
let mediaTitle = "";
let mediaArtist = "";
let isRafLoopRunning = false;

window.isWsConnected = false;

function formatTime(seconds) {
    if (!seconds || seconds <= 0) return "--:--";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}
window.formatTime = formatTime;

function sendMediaAction(action, param = null) {
    if (wsMedia && wsMedia.readyState === WebSocket.OPEN) {
        wsMedia.send(JSON.stringify({ action: action, pos: param, val: param }));
        return true;
    }
    return false;
}
window.sendMediaAction = sendMediaAction;

const playingBar = document.getElementById('playing-bar');

function updatePlayingBar(current, total) {
    if (!playingBar) return;

    const barLength = 67; 
    
    if (!total || total <= 0) {
        playingBar.textContent = "-".repeat(barLength);
        playingBar.dataset.duration = 0; 
        return;
    }

    playingBar.dataset.duration = total;

    let percent = current / total;
    if (percent > 1) percent = 1;
    if (percent < 0) percent = 0;

    const filledLength = Math.floor(barLength * percent);
    const emptyLength = barLength - filledLength;

    let barString = ""; 
    if (filledLength === 0) {
        barString += "-".repeat(barLength);
    } else {
        barString += "=".repeat(filledLength - 1) + ">" + "-".repeat(emptyLength);
    }

    playingBar.textContent = barString;
}
window.updatePlayingBar = updatePlayingBar;

function renderMediaUI(currentPos, duration) {
    const durationElem = document.getElementById('duration');
    if (durationElem) {
        if (duration > 0) {
            durationElem.textContent = `[${formatTime(currentPos)} / ${formatTime(duration)}]`;
        } else if (currentPos > 0) {
            durationElem.textContent = `[${formatTime(currentPos)} / --:--]`;
        } else {
            durationElem.textContent = "[ 0:00 / --:-- ]";
        }
    }
    updatePlayingBar(currentPos, duration);
    if (typeof syncLyrics === 'function') {
        syncLyrics(currentPos);
    }
}

function handleWsMediaUpdate(data) {
    const title = data.media_title || "";
    const artist = data.media_artist || "";
    const status = data.media_status || "Stopped";
    const pos = typeof data.media_position === 'number' ? data.media_position : parseFloat(data.media_position || 0);
    const dur = typeof data.media_duration === 'number' ? data.media_duration : parseFloat(data.media_duration || 0);

    const trackSignature = `${title}-${artist}`;
    const isSongChange = (trackSignature !== window.currentTrackHash && title && title !== "No Media");
    const statusChanged = (status !== mediaStatus);

    const currentLocalPos = (mediaStatus === "Playing" && mediaBaseTime > 0)
        ? (mediaBasePos + (performance.now() - mediaBaseTime) / 1000)
        : mediaBasePos;

    const isDiscontinuity = Math.abs(currentLocalPos - pos) > 0.6;

    mediaTitle = title;
    mediaArtist = artist;
    mediaStatus = status;
    if (dur > 0) {
        mediaDuration = dur;
    }

    const titleEl = document.getElementById('title');
    const artistEl = document.getElementById('artist');
    const albumEl = document.getElementById('album');
    if (titleEl) titleEl.textContent = title || "Waiting for media...";
    if (artistEl) artistEl.textContent = artist || "Idle";
    if (albumEl) albumEl.textContent = data.media_album || "-";

    if (isSongChange) {
        window.currentTrackHash = trackSignature;
        currentMediaPosition = pos;
        optimisticPosition = pos;
        mediaBasePos = pos;
        mediaBaseTime = performance.now();
        lastSeekTime = 0;
        if (typeof currentLyricsData !== 'undefined') currentLyricsData = [];
        if (typeof getLyrics === 'function') {
            getLyrics(title, artist, dur);
        }
    } else if (isDiscontinuity || statusChanged) {
        mediaBasePos = pos;
        mediaBaseTime = performance.now();
        currentMediaPosition = pos;
    } else {
        mediaBasePos = pos;
        mediaBaseTime = performance.now();
    }

    const playButton = document.getElementById('btn-play');
    if (playButton) {
        playButton.textContent = status === 'Playing' ? "[ || ]" : "[ ▶ ]";
    }

    renderMediaUI(currentMediaPosition, mediaDuration);
}

function mediaRenderLoop() {
    if (isWsConnected && mediaStatus === "Playing") {
        const elapsed = (performance.now() - mediaBaseTime) / 1000;
        let currentPos = mediaBasePos + elapsed;
        if (mediaDuration > 0) {
            currentPos = Math.min(mediaDuration, currentPos);
        }
        currentMediaPosition = currentPos;
        renderMediaUI(currentPos, mediaDuration);
    }
    requestAnimationFrame(mediaRenderLoop);
}

function initMediaWebSocket() {
    try {
        wsMedia = new WebSocket("ws://127.0.0.1:25556");
        
        wsMedia.onopen = () => {
            console.log("[Media Engine] Connected to real-time SMTC WebSocket!");
            isWsConnected = true;
            window.isWsConnected = true;
            if (!isRafLoopRunning) {
                isRafLoopRunning = true;
                requestAnimationFrame(mediaRenderLoop);
            }
        };

        wsMedia.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === "media_update") {
                    handleWsMediaUpdate(data);
                } else if (data.type === "volume_update" && data.sys_volume !== undefined) {
                    if (!isDraggingVolume && (Date.now() - lastVolumeSetTime > 1500)) {
                        renderVolumeBar(data.sys_volume);
                    }
                }
            } catch (err) {
                console.error("[Media Engine] Parse error:", err);
            }
        };

        wsMedia.onerror = () => {
            isWsConnected = false;
            window.isWsConnected = false;
        };

        wsMedia.onclose = () => {
            isWsConnected = false;
            window.isWsConnected = false;
            setTimeout(initMediaWebSocket, 2000);
        };
    } catch (e) {
        isWsConnected = false;
        window.isWsConnected = false;
        setTimeout(initMediaWebSocket, 2000);
    }
}

initMediaWebSocket();

// Timeline fallback when WS is offline
function handleHttpMediaFallback(data) {
    const isSeeking = (Date.now() - lastSeekTime < 3000);
    const isOverriding = (optimisticStatus !== null);

    if (optimisticStatus !== null) {
        if (data.media_status === optimisticStatus && (Date.now() - lastPlayPauseTime > 1000)) {
            optimisticStatus = null; 
        } else if (Date.now() - lastPlayPauseTime < 8000) { 
            data.media_status = optimisticStatus; 
        } else {
            optimisticStatus = null; 
        }
    }

    const trackSignature = `${data.media_title}-${data.media_artist}`;
    if (trackSignature !== window.currentTrackHash && data.media_status === 'Playing') {
        window.currentTrackHash = trackSignature;
        currentMediaPosition = 0;
        optimisticPosition = 0;
        lastSeekTime = 0;
        if (typeof currentLyricsData !== 'undefined') currentLyricsData = [];
        if (typeof getLyrics === 'function') getLyrics(data.media_title, data.media_artist, data.media_duration);
    }

    if (!isSeeking && !isOverriding) { 
        if (data.media_position !== undefined && data.media_duration !== undefined) {
            currentMediaPosition = parseFloat(data.media_position);
            renderMediaUI(currentMediaPosition, data.media_duration);
        } else {
            document.getElementById('duration').textContent = "[ - / - ]";
            updatePlayingBar(0, 0);
        }
    } else {
        if (data.media_status === 'Playing') {
            optimisticPosition += 0.25; 
        }
        if (data.media_duration !== undefined) {
            renderMediaUI(optimisticPosition, data.media_duration);
        }
    }

    const playButton = document.getElementById('btn-play');
    if (playButton) {
        playButton.textContent = data.media_status === 'Playing' ? "[ || ]" : "[ ▶ ]"; 
    }
}
window.handleHttpMediaFallback = handleHttpMediaFallback;

// Track Scrubber Drag
if (playingBar) {
    playingBar.style.cursor = 'pointer'; 
    playingBar.addEventListener('mousedown', (e) => {
        e.stopPropagation(); 
        const currentDuration = parseFloat(playingBar.dataset.duration) || 0;
        if (currentDuration <= 0) return; 
        
        const rect = playingBar.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        let percent = Math.max(0, Math.min(1, clickX / rect.width));
        const targetSeconds = currentDuration * percent;

        lastSeekTime = Date.now();
        optimisticPosition = targetSeconds;
        renderMediaUI(targetSeconds, currentDuration);
        
        mediaBasePos = targetSeconds;
        mediaBaseTime = performance.now();
        if (!sendMediaAction('seek', targetSeconds)) {
            fetch(`http://127.0.0.1:25555/media/seek?pos=${targetSeconds}`).catch(e => console.log(e));
        }
    });
}

// Media Control Buttons
const btnPrev = document.getElementById('btn-prev');
const btnPlay = document.getElementById('btn-play');
const btnNext = document.getElementById('btn-next');

if (btnPrev && btnPlay && btnNext) {
    btnPrev.addEventListener('click', () => {
        if (window.isPythonServerRunning !== false) {
            if (!sendMediaAction('prev')) { fetch('http://127.0.0.1:25555/media/prev?t=' + Date.now()).catch(e => console.log(e)); }
        }
    });
    
    btnPlay.addEventListener('click', () => {
        if (window.isPythonServerRunning !== false) {
            if (btnPlay.textContent.includes('||')) {
                optimisticStatus = 'Paused';
                btnPlay.textContent = "[ ▶ ]"; 
            } else {
                optimisticStatus = 'Playing';
                btnPlay.textContent = "[ || ]"; 
            }

            lastPlayPauseTime = Date.now();
            lastSeekTime = Date.now(); 
            optimisticPosition = currentMediaPosition; 
            if (!sendMediaAction('playpause')) { fetch('http://127.0.0.1:25555/media/playpause?t=' + Date.now()).catch(e => console.log(e)); }
        }
    });
    
    btnNext.addEventListener('click', () => {
        if (window.isPythonServerRunning !== false) {
            if (!sendMediaAction('next')) { fetch('http://127.0.0.1:25555/media/next?t=' + Date.now()).catch(e => console.log(e)); }
        }
    });
}

// Volume Control Logic
const volumeControlBar = document.getElementById('volume-control-bar');
const volumeLabel = document.getElementById('sys-volume-label');
let isDraggingVolume = false;
let volumeThrottle = null;
let lastVolumeSetTime = 0;

window.isDraggingVolume = false;
window.lastVolumeSetTime = 0;

function renderVolumeBar(percent) {
    if (!volumeControlBar) return;
    
    const totalLength = 20;
    const clampedPercent = Math.max(0, Math.min(100, Math.round(percent)));
    const filledCount = Math.round((clampedPercent / 100) * totalLength);
    const charFilled = window.charFilled || '|';
    const charEmpty = window.charEmpty || '·';

    let barHTML = '[';
    for (let i = 0; i < totalLength; i++) {
        let colorClass = "green";
        if (i >= 12 && i < 16) colorClass = "yellow";
        else if (i >= 16) colorClass = "red";

        if (i < filledCount) barHTML += `<span class="${colorClass} glow">${charFilled}</span>`;
        else barHTML += `<span class="gray">${charEmpty}</span>`;
    }
    barHTML += ']';
    volumeControlBar.innerHTML = barHTML;
    
    if (volumeLabel) {
        volumeLabel.textContent = clampedPercent.toString().padStart(3, ' ') + '%';
    }
}
window.renderVolumeBar = renderVolumeBar;

if (volumeControlBar) {
    const updateVolumeFromMouse = (e) => {
        const rect = volumeControlBar.getBoundingClientRect();
        if (rect.width <= 0) return;
        let percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const newVol = Math.round(percent * 100);
        
        renderVolumeBar(newVol);
        lastVolumeSetTime = Date.now();
        window.lastVolumeSetTime = lastVolumeSetTime;
        
        sendMediaAction('volume', newVol);

        if (!volumeThrottle) {
            volumeThrottle = setTimeout(() => {
                fetch(`http://127.0.0.1:25555/media/volume?val=${newVol}`, { mode: 'no-cors' })
                    .catch(err => console.log("Volume set error", err));
                volumeThrottle = null;
            }, 80);
        }
    };

    volumeControlBar.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        isDraggingVolume = true;
        window.isDraggingVolume = true;
        updateVolumeFromMouse(e);
    });

    window.addEventListener('mousemove', (e) => {
        if (isDraggingVolume) updateVolumeFromMouse(e);
    });

    window.addEventListener('mouseup', () => {
        if (isDraggingVolume) {
            isDraggingVolume = false;
            window.isDraggingVolume = false;
        }
    });
}

// Initial render and immediate volume check
renderVolumeBar(0);
fetch('http://127.0.0.1:25555/specs')
    .then(r => r.json())
    .then(d => {
        if (d && d.sys_volume !== undefined && !isDraggingVolume) {
            renderVolumeBar(d.sys_volume);
        }
    })
    .catch(() => {});

// Native WE Media Integration Fallback
let isNativePlaying = false;
let nativeMediaDuration = 0;

if (window.wallpaperRegisterMediaPropertiesListener) {
    window.wallpaperRegisterMediaPropertiesListener((event) => {
        const maxLength = 25;
        const truncate = (str, max) => str && str.length > max ? str.substring(0, max - 3) + "..." : str || "Unknown";

        document.getElementById('title').textContent = truncate(event.title, maxLength);
        document.getElementById('artist').textContent = truncate(event.artist, maxLength);
        document.getElementById('album').textContent = truncate(event.albumTitle, maxLength);

        const trackSignature = `${event.title}-${event.artist}`;
        if (trackSignature !== window.currentTrackHash && event.title) {
            if (window.isPythonServerRunning) return;
            
            window.currentTrackHash = trackSignature;
            currentMediaPosition = 0;
            nativeMediaDuration = 0;
            optimisticPosition = 0;
            renderMediaUI(0, 0);
            if (typeof currentLyricsData !== 'undefined') currentLyricsData = [];
            if (typeof getLyrics === 'function') getLyrics(event.title, event.artist, event.duration);
        }
    });
}

if (window.wallpaperRegisterMediaTimelineListener) {
    window.wallpaperRegisterMediaTimelineListener((event) => {
        if (!window.isPythonServerRunning) {
            currentMediaPosition = event.position; 
            nativeMediaDuration = event.duration;
        }
    });
}

if (window.wallpaperRegisterMediaPlaybackListener) {
    window.wallpaperRegisterMediaPlaybackListener((event) => {
        if (!window.isPythonServerRunning) {
            isNativePlaying = (event.state === window.wallpaperMediaIntegration.PLAYBACK_PLAYING);
            const playButton = document.getElementById('btn-play');
            if (playButton) {
                playButton.textContent = isNativePlaying ? "[ || ]" : "[ ▶ ]"; 
            }
        }
    });
}

setInterval(() => {
    if (!window.isPythonServerRunning && isNativePlaying) {
        currentMediaPosition += 0.1; 
        if (currentMediaPosition > nativeMediaDuration && nativeMediaDuration > 0) {
            currentMediaPosition = nativeMediaDuration;
        }
        renderMediaUI(currentMediaPosition, nativeMediaDuration);
    }
}, 100);
