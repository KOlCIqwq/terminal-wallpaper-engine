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
        playingBar.textContent = "Playing: " + "-".repeat(barLength);
        playingBar.dataset.duration = 0; // Reset duration
        return;
    }

    // Save the duration directly onto the HTML element so the clicker can read it
    playingBar.dataset.duration = total;

    let percent = current / total;
    if (percent > 1) percent = 1;
    if (percent < 0) percent = 0;

    const filledLength = Math.floor(barLength * percent);
    const emptyLength = barLength - filledLength;

    let barString = "Playing: ";

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
        
        fetch(`http://127.0.0.1:25555/media/seek?pos=${targetSeconds}`).catch(e => console.log(e));
    });
}

function fetchSystemSpecs() {
    fetch('http://127.0.0.1:25555/specs')
        .then(response => {
            if (!response.ok) throw new Error("Server down");
            return response.json();
        })
        .then(data => {
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

            if (data.media_position) {
                // Ensure position is a number (seconds)
                syncLyrics(parseFloat(data.media_position));
            }

            /*let cur_position = formatTime(data.media_position)
            let cur_duration = formatTime(data.media_duration)

            document.getElementById('duration').textContent = `${cur_position} / ${cur_duration}`; */

            if (data.media_position !== undefined && data.media_duration !== undefined) {
                /* currentMediaDuration = data.media_duration; */

                let cur_position = formatTime(data.media_position);
                let cur_duration = formatTime(data.media_duration);

                document.getElementById('duration').textContent = `[${cur_position} / ${cur_duration}]`;
                updatePlayingBar(data.media_position, data.media_duration);
            } else {
                document.getElementById('duration').textContent = "[ - / - ]";
                updatePlayingBar(0, 0);
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
            setTimeout(fetchSystemSpecs, 1000);
        })
        .catch(err => {
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

let lastResetToggleValue = null;
window.myPropertyHandlers.push(function(properties) {
    let isEditMode = false; // Add this near the top of your property handler block

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
});

const track_info = {
    title: '',
    artist: '',
}

if (window.wallpaperRegisterMediaPropertiesListener) {
    window.wallpaperRegisterMediaPropertiesListener((event) => {
        document.getElementById('title').textContent = event.title || "Unknown Title";
        document.getElementById('artist').textContent = event.artist || "Unknown Artist";
        document.getElementById('album').textContent = event.albumTitle || "Unknown Album";

        if (track_info.title === event.title && track_info.artist === event.artist) {
            return; 
        }

        track_info.title = event.title;
        track_info.artist = event.artist;
    });
}

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
        fetch('http://127.0.0.1:25555/media/prev').catch(e => console.log(e));
    });
    
    btnPlay.addEventListener('click', () => {
        fetch('http://127.0.0.1:25555/media/playpause').catch(e => console.log(e));
    });
    
    btnNext.addEventListener('click', () => {
        fetch('http://127.0.0.1:25555/media/next').catch(e => console.log(e));
    });
}

