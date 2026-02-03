function fetchSystemSpecs() {
    // Connect to the Python local server
    fetch('http://127.0.0.1:25555/specs')
        .then(response => {
            if (!response.ok) throw new Error("Server not reachable");
            return response.json();
        })
        .then(data => {
            // Update the HTML elements
            if(data.os) document.getElementById('os').textContent = data.os;
            if(data.cpu) document.getElementById('cpu').textContent = data.cpu;
            if(data.gpu) document.getElementById('gpu').textContent = data.gpu;
            if(data.ram) document.getElementById('ram').textContent = data.ram;
        })
        .catch(err => {
            console.log("Waiting for hardware host script...", err);
            // Retry in 5 seconds if failed (e.g. wallpaper started before exe)
            setTimeout(fetchSystemSpecs, 5000);
        });
}
// Trigger the fetch when wallpaper loads
fetchSystemSpecs();

window.wallpaperPropertyListener = {
    applyUserProperties: function(properties) {
        if (properties.custom_cpu) {
            document.getElementById('cpu').textContent = properties.custom_cpu.value;
        }
        if (properties.custom_gpu) {
            document.getElementById('gpu').textContent = properties.custom_gpu.value;
        }
        if (properties.custom_ram) {
            document.getElementById('ram').textContent = properties.custom_ram.value;
        }
    }
};

window.wallpaperRegisterMediaPropertiesListener((event) => {
    document.getElementById('title').textContent = event.title || "Unknown Title";
    document.getElementById('artist').textContent = event.artist || "Unknown Artist";
    document.getElementById('album').textContent = event.albumTitle || "Unknown Album";
});

// Thumbnail
window.wallpaperRegisterMediaThumbnailListener((event) => {
    const img = document.getElementById('album-art');
    if (event.thumbnail) {
        img.src = event.thumbnail;
        img.style.display = 'block';
    } else {
        img.style.display = 'none';
    }
});

window.wallpaperRegisterMediaTimelineListener((event) =>{
    if (event.duration > 0){
        const curMin = Math.floor(event.position / 60);
        const curSec = Math.floor(event.position % 60).toString().padStart(2, '0');
        const totMin = Math.floor(event.position / 60);
        const totSec = Math.floor(event.position % 60).toString().padStart(2, '0');

        const timeString = `${curMin}:${curSec} / ${totMin}:${totSec}`;
        document.getElementById('clock').textContent = timeString; 
    }
});

window.wallpaperRegisterMediaPlaybackListener((event) => {
    // 2 = Playing, 1 = Paused, 0 = Stopped
    if (event.state === 0) {
        document.getElementById('title').textContent = "Idle";
        document.getElementById('artist').textContent = "-";
        document.getElementById('album-art').style.display = 'none';
    }
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
}, 1000);
