const CACHE_KEY = "specs"
const overrides = {
    cpu: false,
    gpu: false,
    ram: false
};
// raw inputs
const userLocation = {
    city: "",
    lat: "",
    lon: ""
};
// Final inputs for weather
const position = {
    lat: null,
    lon: null
};

let lastResetToggleValue = null;

let lastSeekTime = 0;
let optimisticPosition = 0;
let optimisticStatus = null;
let lastPlayPauseTime = 0;
let currentMediaPosition = 0;

let currentBgVideo = "";
let currentBgImage = "";
let currentBgDim = 0.6;

let isPythonServerRunning = true;
let isNativePlaying = false;
let nativeMediaDuration = 0;

function loadCachedSpecs(){
    const cached = localStorage.getItem(CACHE_KEY)
    if (cached){
        try{
            const data = JSON.parse(cached);
            if (data.os) document.getElementById('os').textContent = data.os;
            if (data.cpu_name) document.getElementById('cpu').textContent = data.cpu_name;
            if (data.gpu_name) document.getElementById('gpu').textContent = data.gpu_name;
            if (data.ram_total) document.getElementById('ram').textContent = data.ram_total;
            if (data.disk_total) document.getElementById('disk').textContent = data.disk_total;
        } catch (e) {
            localStorage.removeItem(CACHE_KEY);
        }
    }
}

function generateAsciiBar(percent, length = 20) {
    const filledLen = Math.round((percent / 100) * length);
    const emptyLen = length - filledLen;
    // Creates: [||||||......]
    return '[' + '|'.repeat(filledLen) + '.'.repeat(emptyLen) + '] ' + percent.toFixed(1) + '%';
}

function formatTime(seconds){
    if (!seconds || seconds <= 0) return "--:--";
    const m = Math.floor(seconds/60);
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

const playingBar = document.getElementById('playing-bar');

function updatePlayingBar(current, total) {
    if (!playingBar) return;

    const barLength = 67; 
    
    if (!total || total <= 0) {
        // Removed "Playing: " from here
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

    // Start with an empty string instead of "Playing: "
    let barString = ""; 

    if (filledLength === 0) {
        barString += "-".repeat(barLength);
    } else {
        barString += "=".repeat(filledLength - 1) + ">" + "-".repeat(emptyLength);
    }

    playingBar.textContent = barString;
}

if (playingBar) {
    playingBar.style.cursor = 'pointer'; 
    
    playingBar.addEventListener('mousedown', (e) => {
        
        // Stop the drag script from accidentally picking up the widget when clicks the bar
        e.stopPropagation(); 
        
        
        const currentDuration = parseFloat(playingBar.dataset.duration) || 0;
        
        if (currentDuration <= 0) {
            return; 
        }
        
        const rect = playingBar.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        
        let percent = clickX / rect.width;
        if (percent < 0) percent = 0;
        if (percent > 1) percent = 1;
        
        const targetSeconds = currentDuration * percent;

        lastSeekTime = Date.now();
        optimisticPosition = targetSeconds;

        updatePlayingBar(targetSeconds, currentDuration);
        document.getElementById('duration').textContent = `[${formatTime(targetSeconds)} / ${formatTime(currentDuration)}]`;
        
        // Instantly jump the lyrics
        if (typeof syncLyrics === 'function') {
            syncLyrics(targetSeconds);
        }
        
        fetch(`http://127.0.0.1:25555/media/seek?pos=${targetSeconds}`).catch(e => console.log(e));
    });
}

function fetchSystemSpecs() {
    fetch('http://127.0.0.1:25555/specs')
        .then(response => {
            if (!response.ok) throw new Error("Server down");
            // reconnect
            if (!isPythonServerRunning) {
                console.log("Python Server Reconnected!");
                isPythonServerRunning = true;
                
                // Clear the UI locks so the progress bar unfreezes instantly
                lastSeekTime = 0;
                optimisticStatus = null;
                lastPlayPauseTime = 0;
                
                // Force Python's UI to adopt the current Native clock so it doesn't jump
                optimisticPosition = currentMediaPosition;
            }

            return response.json();
        })
        .then(data => {
            if (optimisticStatus !== null) {
                // If the server finally agrees with us (and at least 1 sec passed)
                if (data.media_status === optimisticStatus && (Date.now() - lastPlayPauseTime > 1000)) {
                    optimisticStatus = null; // Server caught up, release the override!
                } else if (Date.now() - lastPlayPauseTime < 8000) { 
                    // Give the server up to 8 seconds to catch up
                    data.media_status = optimisticStatus; 
                } else {
                    // Failsafe: 8 seconds passed and server still disagrees. Give up.
                    optimisticStatus = null; 
                }
            }
            // Static Info
            if (data.os) document.getElementById('os').textContent = data.os;
            
            if (data.cpu_name && !overrides.cpu) {
                document.getElementById('cpu').textContent = data.cpu_name;
            }
            if (data.gpu_name && !overrides.gpu) {
                document.getElementById('gpu').textContent = data.gpu_name;
            }
            if (data.ram_total && data.ram_percent !== undefined && !overrides.ram) {
                document.getElementById('ram').textContent = data.ram_total;
            }

            // Dynamic Info
            if (data.cpu_percent !== undefined) {
                const bar = generateAsciiBar(data.cpu_percent);
                document.getElementById('cpu-bar').textContent = bar;
            }

            if (data.gpu_percent !== undefined) {
                const bar = generateAsciiBar(data.gpu_percent);
                document.getElementById('gpu-bar').textContent = bar;
            }

            if (data.ram_total && data.ram_percent !== undefined) {
                document.getElementById('ram').textContent = data.ram_total;
                const bar = generateAsciiBar(data.ram_percent);
                document.getElementById('ram-bar').textContent = `${bar} (${data.ram_used} GB)`;
            }
            
            if (data.disk_total && data.disk_used !== undefined) {
                document.getElementById('disk').textContent = data.disk_total;
                const bar = generateAsciiBar(data.disk_percent);
                document.getElementById('disk-bar').textContent = `${bar} (${data.disk_used} / ${data.disk_total})`;
            }

            // Process current duration
            const trackSignature = `${data.media_artist} - ${data.media_title}`;
            
            if (trackSignature !== currentTrackHash && data.media_status === 'Playing') {
                currentTrackHash = trackSignature;
                getLyrics(data.media_title, data.media_artist);
            }

            let isSeeking = (Date.now() - lastSeekTime < 3000);
            let isOverriding = (optimisticStatus !== null);

            let rawServerPos = data.media_position !== undefined ? parseFloat(data.media_position).toFixed(2) : "N/A";
            let localPos = optimisticPosition.toFixed(2);

            /* console.log(
                `[Sync Debug] Server: ${rawServerPos}s (${data.media_status}) | ` + 
                `Local: ${localPos}s (Override: ${optimisticStatus || 'None'}) | ` + 
                `State: ${isSeeking || isOverriding ? 'TRUST LOCAL UI' : 'TRUST SERVER'}`
            ); */

            if (!isSeeking && !isOverriding) { 
                // TRUST THE SERVER 
                if (data.media_position !== undefined && data.media_duration !== undefined) {
                    currentMediaPosition = parseFloat(data.media_position); // Update safety tracker
                    
                    let cur_position = formatTime(data.media_position);
                    let cur_duration = formatTime(data.media_duration);

                    document.getElementById('duration').textContent = `[${cur_position} / ${cur_duration}]`;
                    updatePlayingBar(data.media_position, data.media_duration);
                    
                    if (typeof syncLyrics === 'function') syncLyrics(currentMediaPosition);
                } else {
                    document.getElementById('duration').textContent = "[ - / - ]";
                    updatePlayingBar(0, 0);
                }
            } else {
                // TRUST THE LOCAL UI
                if (data.media_status === 'Playing') {
                    optimisticPosition += 0.25; 
                }
                
                if (data.media_duration !== undefined) {
                    document.getElementById('duration').textContent = `[${formatTime(optimisticPosition)} / ${formatTime(data.media_duration)}]`;
                    updatePlayingBar(optimisticPosition, data.media_duration);
                }
                if (typeof syncLyrics === 'function') {
                    syncLyrics(optimisticPosition);
                }
            }

            const playButton = document.getElementById('btn-play');
            if (playButton) {
                if (data.media_status === 'Playing') {
                    playButton.textContent = "[ || ]"; 
                } else {
                    playButton.textContent = "[ ▶ ]"; 
                }
            }

            const dataToSave = {
                os: data.os,
                cpu_name: data.cpu_name,
                gpu_name: data.gpu_name,
                ram_total: data.ram_total,
                disk_total: data.disk_total
            };

            localStorage.setItem(CACHE_KEY, JSON.stringify(dataToSave));

            // KeepAlive
            setTimeout(fetchSystemSpecs, 250);
        })
        .catch(err => {
            let justSwitched = isPythonServerRunning;
            isPythonServerRunning = false;
            document.getElementById('os').textContent = "[ Native Mode Active ]";
            if (justSwitched && typeof updateNativeUI === 'function') {
                updateNativeUI();
                currentMediaPosition = nativeState.position;
                nativeMediaDuration = nativeState.duration;
            }
            setTimeout(fetchSystemSpecs, 5000);
        });
}

// Show cached first
loadCachedSpecs();
// Trigger the fetch when wallpaper loads
fetchSystemSpecs();

window.myPropertyHandlers = window.myPropertyHandlers || [];

if (!window.wallpaperPropertyListener) {
    window.wallpaperPropertyListener = {
        applyUserProperties: function(properties) {
            window.myPropertyHandlers.forEach(handler => handler(properties));
        }
    };
}

window.myPropertyHandlers.push(function(properties) {
    let isEditMode = false;

    // Toggle Edit Mode
    if (properties.edit_mode !== undefined) {
        isEditMode = properties.edit_mode.value;
        
        if (isEditMode) {
            document.body.classList.add('edit-mode-active');
        } else {
            document.body.classList.remove('edit-mode-active');
        }
    }

    if (properties.username) {
        const value = properties.username.value.trim();
        if (value != ""){
            document.getElementById('username').textContent = value;
        }
    }
    if (properties.custom_cpu) {
        const value = properties.custom_cpu.value.trim();
        overrides.cpu = value !== "";
        if (overrides.cpu) {
            document.getElementById('cpu').textContent = value;
        }
    }

    if (properties.custom_gpu) {
        const value = properties.custom_gpu.value.trim();
        overrides.gpu = value !== "";
        if (overrides.gpu) {
            document.getElementById('gpu').textContent = value;
        }
    }

    if (properties.custom_ram) {
        const value = properties.custom_ram.value.trim();
        overrides.ram = value !== "";
        if (overrides.ram) {
            document.getElementById('ram').textContent = value;
        }
    }

    let shouldUpdateWeather = false;

    if (properties.city_name){
        userLocation.city = String(properties.city_name.value).trim();
        shouldUpdateWeather = true;
    }

    if (properties.longitude){
        userLocation.lon = String(properties.longitude.value).trim();
        shouldUpdateWeather = true;
    }

    if (properties.latitude){
        userLocation.lat = String(properties.latitude.value).trim();
        shouldUpdateWeather = true;
    }

    if (shouldUpdateWeather) {
        if (userLocation.lat !== "" && userLocation.lon !== "") {
            position.lat = userLocation.lat;
            position.lon = userLocation.lon;
            getWeather(position.lon, position.lat);
        }
        else if (userLocation.city !== "") {
            updateLocationAndWeather(userLocation.city);
        }
        else {
            document.getElementById("today-weather").innerText = "[ No location provided ]";
            document.getElementById("hourly-weather").innerText = "[ ... ]";
            document.getElementById("next-weather-icons").innerText = "[ ... ]";
            document.getElementById("next-weather-dates").innerText = "[ ... ]";
        }
    }

    if (properties.reset_layout) {
        let currentValue = properties.reset_layout.value;
        
        // If this is the very first time the wallpaper loads, just record the value and do nothing
        if (lastResetToggleValue === null) {
            lastResetToggleValue = currentValue;
        } 
        // changed from last
        else if (currentValue !== lastResetToggleValue) {
            resetAllWidgets();
            lastResetToggleValue = currentValue;
        }
    }

    // controls the toggle of each widget
    const toggleWidget = (property, elementId) => {
        if (property !== undefined) {
            const widget = document.getElementById(elementId);
            if (widget) {
                // If true, remove inline display style so it shows. If false, hide it.
                widget.style.display = property.value ? "" : "none";
            }
        }
    };

    // Check each of the 6 toggles
    toggleWidget(properties.show_sys, 'widget-sys');
    toggleWidget(properties.show_weather, 'widget-weather');
    toggleWidget(properties.show_vis, 'widget-vis');
    toggleWidget(properties.show_media, 'widget-media');
    toggleWidget(properties.show_ascii, 'widget-ascii');
    toggleWidget(properties.show_lyrics, 'widget-lyrics');

    // bg
    if (properties.bg_color) {
        let c = properties.bg_color.value.split(' ');
        let r = Math.round(c[0] * 255), g = Math.round(c[1] * 255), b = Math.round(c[2] * 255);
        document.body.style.backgroundColor = `rgb(${r}, ${g}, ${b})`;
    }

    if (properties.bg_image !== undefined) {
        currentBgImage = properties.bg_image.value;
    }

    if (properties.bg_video !== undefined) {
        currentBgVideo = properties.bg_video.value.trim();
    }

    if (properties.bg_dim !== undefined) {
        currentBgDim = properties.bg_dim.value / 100;
    }

    // Apply Dimming Overlay
    const overlayLayer = document.getElementById('bg-layer-overlay');
    if (overlayLayer) {
        overlayLayer.style.backgroundColor = `rgba(0, 0, 0, ${currentBgDim})`;
    }

    // Apply Image / Video Logic
    const imageLayer = document.getElementById('bg-layer-image');
    const videoLayer = document.getElementById('bg-layer-video');

    if (currentBgVideo !== "") {
        // Video has priority
        let safePath = currentBgVideo.replace(/\\/g, '/');
        let finalUrl = (safePath.includes(':/') && !safePath.startsWith('file:///')) 
            ? 'file:///' + safePath 
            : safePath;
        
        // Use getAttribute to check the exact string we set, avoiding URL encode weirdness
        if (videoLayer.getAttribute('src') !== finalUrl) {
            videoLayer.setAttribute('src', finalUrl);
        }

        videoLayer.style.display = 'block';
        if (imageLayer) imageLayer.style.display = 'none';

        // Enforce Chrome autoplay rules natively
        videoLayer.muted = true;
        videoLayer.loop = true;
        videoLayer.play().catch(err => console.log("Video Play Error:", err));
        
    } else if (currentBgImage !== "") {
        // Fallback to Image
        let safePath = currentBgImage.replace(/\\/g, '/');

        let finalUrl = (safePath.includes(':/') && !safePath.startsWith('file:///')) 
            ? 'file:///' + safePath 
            : safePath;

        imageLayer.style.backgroundImage = `url('file:///${finalUrl}')`; 
        imageLayer.style.display = 'block';
        
        if (videoLayer) {
            videoLayer.style.display = 'none';
            videoLayer.removeAttribute('src'); // Free memory cleanly
            videoLayer.load(); // Force the player to drop the old video
        }
    } else {
        // solid color
        if (imageLayer) imageLayer.style.display = 'none';
        if (videoLayer) {
            videoLayer.style.display = 'none';
            videoLayer.removeAttribute('src');
            videoLayer.load();
        }
    }
});

const track_info = {
    title: '',
    artist: '',
}

const nativeState = {
    isPlaying: false,
    title: "",
    artist: "",
    album: "",
    position: 0,
    duration: 0
};

// media text & lyrics
if (window.wallpaperRegisterMediaPropertiesListener) {
    window.wallpaperRegisterMediaPropertiesListener((event) => {
        const maxLength = 25;
        const truncate = (str, max) => str && str.length > max ? str.substring(0, max - 3) + "..." : str || "Unknown";

        document.getElementById('title').textContent = truncate(event.title, maxLength);
        document.getElementById('artist').textContent = truncate(event.artist, maxLength);
        document.getElementById('album').textContent = truncate(event.albumTitle, maxLength);

        const trackSignature = `${event.artist} - ${event.title}`;
        
        // If the song changed, fetch new lyrics immediately!
        if (trackSignature !== currentTrackHash && event.title) {
            currentTrackHash = trackSignature;
            if (typeof getLyrics === 'function') getLyrics(event.title, event.artist);
        }
    });
}

// NATIVE TIMELINE
if (window.wallpaperRegisterMediaTimelineListener) {
    window.wallpaperRegisterMediaTimelineListener((event) => {
        if (!isPythonServerRunning) {
            currentMediaPosition = event.position; 
            nativeMediaDuration = event.duration;
        }
    });
}

// NATIVE PLAYBACK STATE
if (window.wallpaperRegisterMediaPlaybackListener) {
    window.wallpaperRegisterMediaPlaybackListener((event) => {
        if (!isPythonServerRunning) {
            isNativePlaying = (event.state === window.wallpaperMediaIntegration.PLAYBACK_PLAYING);
            
            const playButton = document.getElementById('btn-play');
            if (playButton) {
                playButton.textContent = isNativePlaying ? "[ || ]" : "[ ▶ ]"; 
            }
        }
    });
}

// Runs at 10 FPS to glide the UI forward between Wallpaper Engine's slow 5-second pings
setInterval(() => {
    if (!isPythonServerRunning && isNativePlaying) {
        currentMediaPosition += 0.1; 
        
        if (currentMediaPosition > nativeMediaDuration && nativeMediaDuration > 0) {
            currentMediaPosition = nativeMediaDuration;
        }
        
        document.getElementById('duration').textContent = `[${formatTime(currentMediaPosition)} / ${formatTime(nativeMediaDuration)}]`;
        updatePlayingBar(currentMediaPosition, nativeMediaDuration);
        
        if (typeof syncLyrics === 'function') syncLyrics(currentMediaPosition);
    }
}, 100);

/* if (window.wallpaperRegisterMediaPropertiesListener) {
    window.wallpaperRegisterMediaPropertiesListener((event) => {

        const maxLength = 25;
        const truncate = (str, max) => {
            if (!str) return "";
            return str.length > max ? str.substring(0, max - 3) + "..." : str;
        };

        document.getElementById('title').textContent = truncate(event.title || "Unknown Title", maxLength);
        document.getElementById('artist').textContent = truncate(event.artist || "Unknown Artist", maxLength);
        document.getElementById('album').textContent = truncate(event.albumTitle || "Unknown Album", maxLength);

        if (track_info.title === event.title && track_info.artist === event.artist) {
            return; 
        }

        track_info.title = event.title;
        track_info.artist = event.artist;
    });
} */

if (window.wallpaperRegisterAudioListener) {
    window.wallpaperRegisterAudioListener((audioArray) => {
        let totalSum = 0;
        let currentMax = 0; // We need the peak to normalize the others

        for (let i = 0; i < 128; i++) {
            let val = audioArray[i];
            totalSum += val;
            if (val > currentMax) currentMax = val;
        }

        let volume = totalSum / 128;

        let normalizer = 1;
        if (currentMax > 0.05) {
            normalizer = 1 / currentMax;
        }

        // Wallpaper Engine returns 128 bins (0-64 = left, 64-127 = right)
        let bass = getAverage(audioArray, 0, 10) * normalizer;
        let mid = getAverage(audioArray, 11, 40) * normalizer;
        let treble = getAverage(audioArray, 41, 63) * normalizer;

        updatePercent('bass-perc',bass);
        updatePercent('mid-perc',mid);
        updatePercent('treble-perc',treble);
        updatePercent('volume-perc', volume * 2);

        updateBar('bar-bass', bass);
        updateBar('bar-mid', mid);
        updateBar('bar-treble', treble);
        updateBar('bar-volume', volume * 2);
    });
}

function getAverage(array, start, end) {
    let sum = 0;
    for (let i = start; i <= end; i++) {
        sum += array[i];
    }
    return sum / (end - start + 1);
}

function updateBar(elementId, value) {
    const chars = 20; 
    const filled = Math.floor(Math.min(value, 1) * chars);
    const bar = "|".repeat(filled).padEnd(chars, ".");
    document.getElementById(elementId).textContent = bar;
}

function updatePercent(elementId, val){
    let percentage = Math.round(val * 100);
    if (percentage > 100) percentage = 100;
    document.getElementById(elementId).textContent = percentage + '%';
}

let lastWeatherHour = -1;
let lastWeatherMinute = -1;

setInterval(() => {
    const now = new Date();
    document.getElementById('clock').textContent = now.toLocaleTimeString();
    document.getElementById('date').textContent = now.toLocaleDateString();

    // refresh the weather at each hour
    if (now.getMinutes() != lastWeatherMinute){
        lastWeatherMinute = now.getMinutes();
        if (now.getHours() !== lastWeatherHour) {
            // Ensure we have coordinates
            if (position.lon && position.lat) {
                getWeather(position.lon, position.lat);
                lastWeatherHour = now.getHours();
            }
        }
    }
    
}, 1000);

/* localStorage.clear();  */

const widgets = document.querySelectorAll('.draggable-widget');
let activeWidget = null;
let startX, startY, initialLeft, initialTop;
let isTicking = false; 

// Initial spacing for brand new loads
let defaultTop = 40;

// Load saved positions for all widgets
widgets.forEach((widget) => {
    const savedPos = localStorage.getItem('pos_' + widget.id);
    if (savedPos) {
        const pos = JSON.parse(savedPos);
        widget.style.left = pos.left;
        widget.style.top = pos.top;
    } else {
        widget.style.left = "40px";
        widget.style.top = defaultTop + "px"; 
        defaultTop += 220; 
    }

    widget.addEventListener('mousedown', (e) => {
        // locked mode
        if (!document.body.classList.contains('edit-mode-active')) return;

        activeWidget = widget;
        startX = e.clientX;
        startY = e.clientY;
        
        const rect = widget.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;
        
        widgets.forEach(w => w.style.zIndex = 1);
        widget.style.zIndex = 10;
    });
});

// Move the widget 
document.addEventListener('mousemove', (e) => {
    if (!activeWidget) return;

    if (!isTicking) {
        window.requestAnimationFrame(() => {
            if(!activeWidget) { isTicking = false; return; } // Safety check
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            
            activeWidget.style.left = `${initialLeft + dx}px`;
            activeWidget.style.top = `${initialTop + dy}px`;
            
            isTicking = false;
        });
        isTicking = true;
    }
});

// Save the position (Attached to WINDOW, not document)
window.addEventListener('mouseup', () => {
    if (activeWidget) {
        localStorage.setItem('pos_' + activeWidget.id, JSON.stringify({
            left: activeWidget.style.left,
            top: activeWidget.style.top
        }));
        activeWidget = null;
    }
});

// If mouse leaves the desktop entirely, drop the widget
document.addEventListener('mouseleave', () => {
    activeWidget = null;
});

// reset
/* const resetBtn = document.getElementById('reset-btn');

if (resetBtn) {
    resetBtn.addEventListener('click', () => {
        let resetTop = 40;
        
        widgets.forEach((widget) => {
            // Move it back to the left side physically
            widget.style.left = "40px";
            widget.style.top = resetTop + "px";
            
            // Add the spacing for the next widget in the list
            resetTop += 220; 
            
            // Delete its custom saved position from memory
            localStorage.removeItem('pos_' + widget.id);
        });
    });
}
 */

function resetAllWidgets() {
    let resetTop = 40; 
    const widgets = document.querySelectorAll('.draggable-widget');
    
    widgets.forEach((widget) => {
        // Move it back to the left side
        widget.style.left = "40px";
        widget.style.top = resetTop + "px";
        resetTop += 220; 
        
        // Delete memory
        localStorage.removeItem('pos_' + widget.id);
    });
}

//media control
const btnPrev = document.getElementById('btn-prev');
const btnPlay = document.getElementById('btn-play');
const btnNext = document.getElementById('btn-next');

if (btnPrev && btnPlay && btnNext) {
    btnPrev.addEventListener('click', () => {
        if (isPythonServerRunning) {
            fetch('http://127.0.0.1:25555/media/prev?t=' + Date.now()).catch(e => console.log(e));
        } else {
            console.log("Controls disabled. Python script required to send commands to Windows.");
        }
    });
    
    btnPlay.addEventListener('click', () => {
        if (isPythonServerRunning) {
            // Optimistic UI update
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
            fetch('http://127.0.0.1:25555/media/playpause?t=' + Date.now()).catch(e => console.log(e));
        } else {
            console.log("Controls disabled. Python script required to send commands to Windows.");
        }
    });
    
    btnNext.addEventListener('click', () => {
        if (isPythonServerRunning) {
            fetch('http://127.0.0.1:25555/media/next?t=' + Date.now()).catch(e => console.log(e));
        } else {
            console.log("Controls disabled. Python script required to send commands to Windows.");
        }
    });
}