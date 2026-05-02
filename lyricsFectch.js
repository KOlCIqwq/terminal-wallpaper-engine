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
    
    // Try Lyrics Plus
    for (const query of uniqueQueries) {
        try {
            const lpData = await fetchLyricsPlusAPI(query.t, query.a);
            if (lpData && lpData.length > 2) {
                currentLyricsData = lpData;
                renderLyricsToDom();
                return; // Exit on success
            }
        } catch (err) {
            console.log(`[Lyrics Plus] Bypassed for "${query.t}":`, err.message);
        }
    }

    // Try Better Lyrics first
    for (const query of uniqueQueries) {
        try {
            const blData = await fetchBetterLyricsAPI(query.t, query.a);
            
            // Check if we got more than just the 0 and 9999 padding objects
            if (blData && blData.length > 2) {
                currentLyricsData = blData;
                renderLyricsToDom();
                return; // Exit on success
            }
        } catch (err) {
            console.error(`[Better Lyrics] Error for "${query.t}":`, err.message || err);        
        }
    }

    console.log("[lrclib] Attempting fallback...");

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
    
    currentLyricsData.forEach((line, lineIndex) => {
        const div = document.createElement('div');
        div.className = 'lyric-line';
        div.id = `line-${lineIndex}`;
        
        // if better lyrics or lyrics plus is fetched
        if (line.words && line.words.length > 0) {
            line.words.forEach((word, wordIndex) => {
                const span = document.createElement('span');
                span.className = 'lyric-word';
                span.id = `word-${lineIndex}-${wordIndex}`;
                span.textContent = word.text; // Includes the trailing spaces
                div.appendChild(span);
            });
        } else {
            // Fallback for standard lrclib LRC data
            div.textContent = line.text;
        }
        container.appendChild(div);
    });
}

function syncLyrics(currentPositionSeconds) {
    if (!currentLyricsData.length) return;
    // smooth out
    const searchTime = currentPositionSeconds + 0.99; 
    let activeLineIndex = -1;

    // Find the current active line
    for (let i = 0; i < currentLyricsData.length; i++) {
        if (currentLyricsData[i].time <= searchTime) {
            activeLineIndex = i;
        } else {
            break; 
        }
    }

    if (activeLineIndex !== -1) {
        const previousActive = document.querySelector('.lyric-line.active');
        
        // Line UI Updates & Scrolling
        if (!previousActive || previousActive.id !== `line-${activeLineIndex}`) {
            if (previousActive) {
                previousActive.classList.remove('active');
                // Clean up any lingering sung words from the previous line
                previousActive.querySelectorAll('.lyric-word.sung').forEach(w => w.classList.remove('sung'));
            }
            
            const activeEl = document.getElementById(`line-${activeLineIndex}`);
            if (activeEl) {
                activeEl.classList.add('active');
                
                activeEl.scrollIntoView({
                    behavior: 'smooth', 
                    block: 'center',
                    inline: 'nearest'
                });
            }
        }

        // Word Syncing
        const activeLineData = currentLyricsData[activeLineIndex];
        
        if (activeLineData && activeLineData.words && activeLineData.words.length > 0) {
            const wordSearchTime = currentPositionSeconds; 
            
            // Get all word spans in the current active line
            const wordSpans = document.getElementById(`line-${activeLineIndex}`).querySelectorAll('.lyric-word');
            
            activeLineData.words.forEach((word, wordIndex) => {
                const wordSpan = wordSpans[wordIndex];
                if (wordSpan) {
                    // If the song has passed this word's start time
                    if (word.time <= wordSearchTime) {
                        wordSpan.classList.add('sung');
                    } else {
                        // Keep it white/dim if the song hasn't reached it yet
                        wordSpan.classList.remove('sung');
                    }
                }
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