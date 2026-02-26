const CACHE_KEY = "specs"
const overrides = {
    cpu: false,
    gpu: false,
    ram: false
};
const position = {
    lon: 0.0,
    lat: 0.0
}

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

function updatePlayingBar(current, total) {
    const barElement = document.getElementById('playing-bar');
    if (!barElement) return;

    const barLength = 78; 
    
    if (!total || total <= 0) {
        barElement.textContent = "Playing: " + "-".repeat(barLength);
        return;
    }

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

    barElement.textContent = barString;
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
                let cur_position = formatTime(data.media_position);
                let cur_duration = formatTime(data.media_duration);

                document.getElementById('duration').textContent = `[${cur_position} / ${cur_duration}]`;
                updatePlayingBar(data.media_position, data.media_duration);
            } else {
                document.getElementById('duration').textContent = "[ - / - ]";
                updatePlayingBar(0, 0);
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

window.myPropertyHandlers.push(function(properties) {
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

    if (properties.longitude){
        const value = String(properties.longitude.value).trim();
        if (value !== "") {
            position.lon = value;
            shouldUpdateWeather = true;
        }
    }

    if (properties.latitude){
        const value = String(properties.latitude.value).trim();
        position.lat = value !== "";
        if (value !== "") {
            position.lat = value;
            shouldUpdateWeather = true;
        }
    }

    if (shouldUpdateWeather && position.lon && position.lat) {
        getWeather(position.lon, position.lat);
    }
});

const track_info = {
    title: '',
    artist: '',
}

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

setInterval(() => {
    const now = new Date();
    document.getElementById('clock').textContent = now.toLocaleTimeString();
    document.getElementById('date').textContent = now.toLocaleDateString();

    // refresh the weather at each hour
    if (now.getMinutes() === 0 && now.getSeconds() === 2) {
        // check it has actually provided coordinates yet
        if (position.lon && position.lat) {
            getWeather(position.lon, position.lat);
        }
    }
}, 1000);
