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

async function getLyrics(title, artist, duration = -1) {
    appendLog(`[LYRICS] Requesting sync for: ${cleanTitle(title)}`);
    const requestHash = `${title}-${artist}`;
    currentTrackHash = requestHash;

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
        index === self.findIndex((t) => 
            t.t.toLowerCase() === q.t.toLowerCase() && 
            t.a.toLowerCase() === q.a.toLowerCase()
        )
    );

    let savedUnsyncedLyrics = null;
    
    // Try Lyrics Plus
    for (const query of uniqueQueries) {
        try {
            appendLog(`[LYRICS] Trying Lyrics Plus`);
            const lpData = await fetchLyricsPlusAPI(query.t, query.a);
            if (currentTrackHash !== requestHash) return;
            if (lpData && lpData.length > 2) {
                if (lpData.isSynced) {
                    currentLyricsData = lpData;
                    currentLyricsData.provider = "Lyrics Plus";
                    appendLog(`[LYRICS] Success via ${currentLyricsData.provider}`);
                    renderLyricsToDom();
                    return;
                } else if (!savedUnsyncedLyrics) {
                    console.log(`[Lyrics Plus] Found unsynced text for "${query.t}". Saving just in case...`);
                    savedUnsyncedLyrics = lpData; // Save it
                    savedUnsyncedLyrics.sourceName = "Lyrics Plus";
                }
            }
        } catch (err) {
            console.log(`[Lyrics Plus] Bypassed for "${query.t}":`, err.message);
            if (err.message.includes("401") || err.message.includes("403") || err.message.includes("429") || err.message.includes("50")) {
                console.log("[Lyrics Plus] API is currently locked/down. Aborting variations.");
                break;
            }
        }
    }

    // Try Better Lyrics
    for (const query of uniqueQueries) {
        try {
            appendLog(`[LYRICS] Trying Better Lyrics`);
            const blData = await fetchBetterLyricsAPI(query.t, query.a, duration);

            if (currentTrackHash !== requestHash) return;

            if (blData && blData.length > 2) {
                if (blData.isSynced) {
                    currentLyricsData = blData;
                    currentLyricsData.provider = "Better Lyrics";
                    appendLog(`[LYRICS] Success via ${currentLyricsData.provider}`);
                    renderLyricsToDom();
                    return;
                } else if (!savedUnsyncedLyrics) {
                    console.log(`[Better Lyrics] Found unsynced text for "${query.t}". Saving...`);
                    savedUnsyncedLyrics = blData; 
                    savedUnsyncedLyrics.sourceName = "Better Lyrics"; 
                }
            }
        } catch (err) {
            console.log(`[Better Lyrics] Bypassed for "${query.t}":`, err.message);
            if (err.message.includes("401") || err.message.includes("403") || err.message.includes("429") || err.message.includes("50")) {
                console.log("[Better Lyrics] API is currently locked/down. Aborting variations.");
                break; // Breaks out of the Better Lyrics loop and moves straight to Lrclib
            }
        }
    }

    console.log("[lrclib] Attempting fallback...");

    // Try each query in sequence
    for (const query of uniqueQueries) {
        try {
            appendLog(`[LYRICS] Trying Lrclib`);
            if (currentTrackHash !== requestHash) return;
            const params = new URLSearchParams({
                artist_name: query.a,
                track_name: query.t
            });
            
            const response = await fetch(`https://lrclib.net/api/get?${params.toString()}`);
            
            if (response.ok) {
                const data = await response.json();
                if (data.syncedLyrics) {
                    currentLyricsData = parseLRC(data.syncedLyrics);
                    currentLyricsData.provider = "Lrclib";
                    appendLog(`[LYRICS] Success via ${currentLyricsData.provider}`);
                    renderLyricsToDom();
                    return; // Exit when found 
                }
                else if (data.plainLyrics && !savedUnsyncedLyrics) {
                    console.log(`[Lrclib] Found plain lyrics via exact match. Saving...`);
                    savedUnsyncedLyrics = data.plainLyrics.split('\n').map(line => ({ time: 0, text: line }));
                    savedUnsyncedLyrics.isSynced = false;
                    savedUnsyncedLyrics.sourceName = "Lrclib";
                }
            }
        } catch (err) {
            // Silently ignore errors for current attempt and let the loop try the next fallback
            console.log(`Failed query for "${query.t}" by "${query.a}", trying next...`);
            break;
        }
    }

    for (const query of uniqueQueries) {
        try {
            appendLog(`[LYRICS] Trying LrcLib Search`);
            if (currentTrackHash !== requestHash) return;
            // Search using just the title to cast a wide net
            const params = new URLSearchParams({ q: query.t });
            const response = await fetch(`https://lrclib.net/api/search?${params.toString()}`);
            
            if (response.ok) {
                const results = await response.json();
                
                // Filter the results array to ensure the artist roughly matches 
                // (case-insensitive, partial matches allowed)
                const validMatches = results.filter(track => 
                    track.artistName.toLowerCase().includes(query.a.toLowerCase()) || 
                    query.a.toLowerCase().includes(track.artistName.toLowerCase())
                );

                // Look for the first valid match with synced lyrics
                const syncedMatch = validMatches.find(track => track.syncedLyrics);
                if (syncedMatch) {
                    console.log(`[lrclib] Found synced lyrics via search API for "${query.t}"`);
                    currentLyricsData = parseLRC(syncedMatch.syncedLyrics);
                    currentLyricsData.provider = "Lrclib";
                    appendLog(`[LYRICS] Success via ${currentLyricsData.provider}`);
                    renderLyricsToDom();
                    return;
                }

                // If no synced lyrics, grab plain lyrics as an absolute last resort
                if (!savedUnsyncedLyrics) {
                    const unsyncedMatch = validMatches.find(track => track.plainLyrics);
                    if (unsyncedMatch) {
                        console.log(`[lrclib] Found plain lyrics via search API for "${query.t}". Saving...`);
                        
                        // Structure it so it mimics the other unsynced payloads
                        savedUnsyncedLyrics = unsyncedMatch.plainLyrics.split('\n').map(line => ({ time: 0, text: line }));
                        savedUnsyncedLyrics.isSynced = false;
                        savedUnsyncedLyrics.sourceName = "lrclib";
                    }
                }
            }
        } catch (err) {
            console.log(`Failed search query for "${query.t}", trying next...`);
            break;
        }
    }

    console.log("[KuGou] Attempting fallback...");
    // Try KuGou
    for (const query of uniqueQueries) {
        appendLog(`[LYRICS] Trying KuGou`);
        try {
            if (currentTrackHash !== requestHash) return;
            const kgData = await fetchKugouLyricsAPI(query.t, query.a, duration);
            
            if (kgData) {
                if (kgData.includes("纯音乐") || kgData.includes("请欣赏")) {
                    if (!savedUnsyncedLyrics){
                        savedUnsyncedLyrics = "Instrumental"
                    }
                    continue; // Skip and let it fall back to savedUnsyncedLyrics
                }

                const parsedData = parseLRC(kgData);
                
                if (parsedData && parsedData.length > 2) {
                    currentLyricsData = parsedData;
                    currentLyricsData.provider = "KuGou";
                    appendLog(`[LYRICS] Success via ${currentLyricsData.provider}`);
                    renderLyricsToDom();
                    return; 
                } else {
                    console.log(`[KuGou] Rejected: Not enough lines.`);
                }
            }
        } catch (err) {
            console.error(`[KuGou] Error for "${query.t}":`, err.message || err);
        }
    }
    
    // got cached unsynced
    if (savedUnsyncedLyrics) {
        console.log("No synced lyrics found across any provider. Deploying plain text fallback.");
        currentLyricsData = savedUnsyncedLyrics;
        currentLyricsData.provider = `${savedUnsyncedLyrics.sourceName} (Unsynced)`;
        appendLog(`[LYRICS] Success via ${currentLyricsData.provider}`);
        renderLyricsToDom();
        return; 
    }

    // If the loop finishes without returning, all fallbacks failed.
    /* container.innerHTML = '<br><span class="dim">No sync data found.</span>'; */
    appendLog(`[LYRICS] Failed to fetch lyrics`);
    currentLyricsData = [];
}

function renderLyricsToDom() {
    const container = document.getElementById('lyrics-container');
    const scrollControls = document.getElementById('lyrics-scroll-controls');
    const providerLabel = document.getElementById('lyrics-provider');
    container.innerHTML = ''; // Clear

    if (providerLabel) {
        if (currentLyricsData && currentLyricsData.provider) {
            providerLabel.textContent = `[ SOURCE: ${currentLyricsData.provider} ]`;
        } else {
            providerLabel.textContent = '';
        }
    }

    const isUnsynced = currentLyricsData.isSynced === false;

    // when unsynced, make it able to scroll
    if (isUnsynced) {
        container.classList.add('unsynced-view');
        container.scrollTop = 0; 
        if (scrollControls) scrollControls.style.display = "flex"; // Show buttons
    } else {
        container.classList.remove('unsynced-view');
        if (scrollControls) scrollControls.style.display = "none"; // Hide buttons
    }
    
    currentLyricsData.forEach((line, lineIndex) => {
        const div = document.createElement('div');
        div.className = 'lyric-line';
        div.id = `line-${lineIndex}`;

        if (isUnsynced) {
            div.style.opacity = "1";
        }
        
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
    // empty or unsynced
    if (!currentLyricsData.length || currentLyricsData.isSynced === false) return;
    // smooth out
    const searchTime = currentPositionSeconds + 0.05; 
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
    
function cleanTitle(title) {
    if (!title) return "";
    let safeText = String(title);

    const keepTags = ["slowed", "reverb", "sped up", "acoustic", "live", "remix", "cover", "instrumental", "radio edit"];
    let savedTags = []; // Store the exact case-sensitive matches

    keepTags.forEach((tag) => {
        // Look for the tag anywhere inside ( ) or [ ] case-insensitively
        const regex = new RegExp(`[\\(\\[][^\\)\\]]*?${tag}[^\\)\\]]*?[\\)\\]]`, 'gi');
        safeText = safeText.replace(regex, (match) => {
            savedTags.push(match); // Save the exact original string (e.g., "(Sped Up)")
            return `__TAG_${savedTags.length - 1}__`; 
        });
    });

    // Purge remaining junk
    let cleanedText = safeText.replace(/\(.*?\)/gi, "").replace(/\[.*?\]/gi, "");

    // Restore the exact tags with original capitalization
    savedTags.forEach((savedTag, index) => {
        cleanedText = cleanedText.replace(`__TAG_${index}__`, savedTag);
    });

    cleanedText = cleanedText.replace(/\s*-\s+(feat\.|ft\.|featuring|with).*$/gi, '');

    // Replace double spaces with a single space and trim
    return cleanedText.replace(/\s+/g, ' ').trim();
}

function cleanArtist(artist) {
    if (!artist) return ""; // Protect against undefined/null
    return String(artist).split(/,|&|\+| and | ft\.? | feat\.? | featuring /i)[0].trim();
}