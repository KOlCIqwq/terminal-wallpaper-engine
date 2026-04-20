let currentLyricsData = []; 
let currentTrackHash = ""; // To detect if song changed

function parseLRC(lrcString) {
    const lines = lrcString.split('\n');
    const result = [];
    
    const timeReg = /\[(\d{2,}):(\d{2}(?:\.\d+)?)\]/;

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

    result.push({ time: 9999, text: ' '})
    return result;
}

async function getLyrics(title, artist) {
    const container = document.getElementById('lyrics-container');
    container.innerHTML = '<br><span class="dim">Downloading data packet...</span>';
    
    const cTitle = cleanTitle(title);
    const cArtist = cleanArtist(artist);

    const queries = [
        { t: title, a: artist },  // Exact original match
        { t: cTitle, a: artist }, // Cleaned title, exact artist
        { t: cTitle, a: cArtist } // Cleaned title, primary artist only
    ];

    // Deduplicate queries in case the cleanup didn't change the strings
    const uniqueQueries = queries.filter((q, index, self) =>
        index === self.findIndex((t) => t.t === q.t && t.a === q.a)
    );

    // Try each query in sequence
    for (const query of uniqueQueries) {
        try {
            const params = new URLSearchParams({
                artist_name: query.a,
                track_name: query.t
            });
            
            const response = await fetch(`https://lrclib.net/api/get?${params.toString()}`);
            
            if (response.ok) {
                const data = await response.json();
                if (data.syncedLyrics) {
                    currentLyricsData = parseLRC(data.syncedLyrics);
                    renderLyricsToDom();
                    return; // Exit when found 
                }
            }
        } catch (err) {
            // Silently ignore errors for current attempt and let the loop try the next fallback
            console.log(`Failed query for "${query.t}" by "${query.a}", trying next...`);
        }
    }

    // If the loop finishes without returning, all fallbacks failed.
    container.innerHTML = '<br><span class="dim">Target offline. No sync data found.</span>';
    currentLyricsData = [];
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

    /* if (activeIndex !== -1) {
        console.log(`Active Line [${activeIndex}]: "${activeText}" at time ${currentLyricsData[activeIndex].time}`);
    } else {
        console.log("No active line found for time:", searchTime);
    } */

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

// Removes "(feat. xxx)", "[ft. xxx]", "(with xxx)", or "- feat. xxx"
function cleanTitle(title) {
    let cleaned = title.replace(/\s*[\(\[](feat\.|ft\.|featuring|with)\s+[^)\]]+[\)\]]/gi, '');
    cleaned = cleaned.replace(/\s*-\s+(feat\.|ft\.|featuring|with).*$/gi, '');
    return cleaned.trim();
}

// Keeps only the primary artist by splitting at common delimiters
function cleanArtist(artist) {
    return artist.split(/,|&|\+| and | ft\.? | feat\.? | featuring /i)[0].trim();
}