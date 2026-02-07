let currentLyricsData = []; 
let currentTrackHash = ""; // To detect if song changed

function parseLRC(lrcString) {
    const lines = lrcString.split('\n');
    const result = [];
    
    const timeReg = /\[(\d{2}):(\d{2}\.\d{2,})\]/;

    result.push({ time: 0, text: ' '})

    lines.forEach(line => {
        const match = timeReg.exec(line);
        if (match) {
            const min = parseInt(match[1]);
            const sec = parseFloat(match[2]);
            const totalSeconds = (min * 60) + sec;
            const text = line.replace(timeReg, '').trim();
            
            if (text) { // Only add non-empty lines
                result.push({ time: totalSeconds, text: text });
            }
        }
    });
    return result;
}

function getLyrics(title, artist){
    const params = new URLSearchParams({
        artist_name: artist,
        track_name: title
    });
    document.getElementById('lyrics-container').innerHTML = '<span class="dim">Downloading data packet...</span>';
    fetch(`https://lrclib.net/api/get?${params.toString()}`)
        .then(response => {
            if (!response.ok) throw new Error("Lyrics not found or Server down");
            return response.json();
        })
        .then(data => {
            if (data.syncedLyrics) {
                currentLyricsData = parseLRC(data.syncedLyrics);
                renderLyricsToDom(); // Initial render
            } else {
                document.getElementById('lyrics-container').innerHTML = '<span class="dim">Error: Sync data missing.</span>';
                currentLyricsData = [];
            }
        })
        .catch(err => {
            document.getElementById('lyrics-container').innerHTML = '<span class="dim">Target offline. No lyrics.</span>';
            currentLyricsData = [];
        });
}

function renderLyricsToDom() {
    const container = document.getElementById('lyrics-container');
    container.innerHTML = ''; // Clear
    
    currentLyricsData.forEach((line, index) => {
        const div = document.createElement('div');
        div.className = 'lyric-line';
        div.id = `line-${index}`;
        div.textContent = line.text;
        container.appendChild(div);
    });
}

function syncLyrics(currentPositionSeconds) {
    if (!currentLyricsData.length) return;
    const searchTime = currentPositionSeconds + 0.99;

    let activeIndex = -1;
    let activeText = "";

    // Find the current active line
    for (let i = 0; i < currentLyricsData.length; i++) {
        if (currentLyricsData[i].time <= searchTime) {
            activeIndex = i;
            activeText = currentLyricsData[i].text;
        } else {
            break; 
        }
    }

    if (activeIndex !== -1) {
        console.log(`Active Line [${activeIndex}]: "${activeText}" at time ${currentLyricsData[activeIndex].time}`);
    } else {
        console.log("No active line found for time:", searchTime);
    }

    // UI Updates
    if (activeIndex !== -1) {
        const previousActive = document.querySelector('.lyric-line.active');
        if (previousActive) {
            if (previousActive.id === `line-${activeIndex}`) return; 
            previousActive.classList.remove('active');
        }
        const activeEl = document.getElementById(`line-${activeIndex}`);
        if (activeEl) {
            activeEl.classList.add('active');
            
            activeEl.scrollIntoView({
                behavior: 'smooth', 
                block: 'center',
                inline: 'nearest'
            });
        }
    }
}