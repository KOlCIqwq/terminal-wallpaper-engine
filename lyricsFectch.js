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

const PROVIDER_TIMEOUT_MS = 5000;

function withTimeout(promise, ms = PROVIDER_TIMEOUT_MS, label = "Provider") {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            reject(new Error(`${label} timed out after ${ms / 1000}s`));
        }, ms);
    });

    return Promise.race([promise, timeoutPromise]).finally(() => {
        clearTimeout(timeoutId);
    });
}

function scaleLyrics(lyricsData, factor) {
    if (!lyricsData || !Array.isArray(lyricsData) || factor <= 0 || Math.abs(factor - 1.0) < 0.03) return lyricsData;

    return lyricsData.map(line => {
        if (line.time <= 0 || line.time >= 9000) {
            return { ...line };
        }

        const newLine = {
            ...line,
            time: Math.round(line.time * factor * 100) / 100
        };

        if (line.words && Array.isArray(line.words)) {
            newLine.words = line.words.map(w => ({
                ...w,
                time: (w.time > 0 && w.time < 9000) ? Math.round(w.time * factor * 100) / 100 : w.time
            }));
        }

        return newLine;
    });
}

function parseSongTitle(rawTitle) {
    if (!rawTitle) return { baseTitle: "", variationTag: "", variationType: null, isVariation: false };

    let text = String(rawTitle).trim();

    // Remove streaming & video metadata junk
    const junkRegex = /[\(\[]\s*(official\s+(music\s+)?(video|audio)|lyric\s+video|audio|video|mv|visualizer|hd|4k|1080p|explicit|clean)\s*[\)\]]/gi;
    text = text.replace(junkRegex, '').trim();
    text = text.replace(/\s*-\s*(official\s+(music\s+)?(video|audio)|lyric\s+video|audio|video|visualizer).*$/gi, '').trim();

    // Remove remaster, deluxe, anniversary, and release edition tags
    const remasterBracketRegex = /[\(\[]\s*(?:(?:\d{4}\s*)?remaster(?:ed)?(?:\s*\d{4})?|digitally\s*remastered|remastered\s*version|deluxe\s*(?:edition|version)|anniversary\s*edition|special\s*edition|expanded\s*edition|bonus\s*track|original\s*mix|single\s*version|album\s*version|mono|stereo)\s*[\)\]]/gi;
    text = text.replace(remasterBracketRegex, '').trim();

    const remasterHyphenRegex = /\s*-\s*(?:(?:\d{4}\s*)?remaster(?:ed)?(?:\s*\d{4})?|digitally\s*remastered|deluxe\s*(?:edition|version)|anniversary\s*edition|original\s*mix|album\s*version).*$/gi;
    text = text.replace(remasterHyphenRegex, '').trim();

    // Strip featured artists
    text = text.replace(/[\(\[]\s*(feat\.|ft\.|featuring|with)\s+[^()\[\]]+[\)\]]/gi, '').trim();
    text = text.replace(/\s*-\s+(feat\.|ft\.|featuring|with)\s+.*$/gi, '').trim();

    const speedUpPattern = /(?:sped\s*up|speed\s*up|speedup|nightcore|fast\s*version|pitch\s*up)/i;
    const slowedPattern = /(?:slowed(?:\s*(?:\+|&|and)\s*reverb)?|slowed\s*down|daycore|pitch\s*down|reverb)/i;
    const otherVarPattern = /(?:remix|vip|acoustic|live|instrumental|cover|radio\s*edit|extended\s*mix)/i;

    let variationType = null;
    let variationTag = "";
    let isVariation = false;

    // Check bracketed tags first: e.g. (Sped Up), [Slowed + Reverb]
    const bracketMatch = text.match(/[\(\[]\s*([^()\[\]]*?(?:sped\s*up|speed\s*up|speedup|nightcore|slowed|daycore|reverb|remix|acoustic|live|instrumental|cover)[^()\[\]]*?)\s*[\)\]]/i);
    // Check hyphen-separated tags: e.g. "Song - Sped Up"
    const hyphenMatch = text.match(/\s*-\s*([^-\(\)[\]]*?(?:sped\s*up|speed\s*up|speedup|nightcore|slowed|daycore|reverb|remix|acoustic|live|instrumental|cover)[^-\(\)[\]]*?)$/i);

    let matchedTagStr = "";
    if (bracketMatch) {
        matchedTagStr = bracketMatch[1].trim();
    } else if (hyphenMatch) {
        matchedTagStr = hyphenMatch[1].trim();
    }

    if (matchedTagStr) {
        isVariation = true;
        variationTag = matchedTagStr;
        if (speedUpPattern.test(matchedTagStr)) {
            variationType = "sped up";
        } else if (slowedPattern.test(matchedTagStr)) {
            variationType = "slowed";
        } else if (otherVarPattern.test(matchedTagStr)) {
            variationType = "other";
        }
    }

    let baseTitle = text;
    if (bracketMatch) {
        baseTitle = baseTitle.replace(bracketMatch[0], '');
    }
    if (hyphenMatch) {
        baseTitle = baseTitle.replace(hyphenMatch[0], '');
    }
    baseTitle = baseTitle.replace(/[\(\[]\s*[\)\]]/g, '').replace(/\s+/g, ' ').trim();

    return {
        baseTitle: baseTitle || text,
        variationTag,
        variationType,
        isVariation
    };
}

function isArtistMatch(artist1, artist2) {
    if (!artist1 || !artist2) return false;
    const norm = (s) => String(s).toLowerCase()
        .replace(/['’`]/g, '')
        .replace(/[\.\,\/\\_\-\(\)\[\]]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const a1 = norm(artist1);
    const a2 = norm(artist2);
    if (a1 === a2) return true;

    const splitRegex = /\s*(?:,|&|\+|\/|(?:\s+and\s+)|\s+ft\.?\s+|\s+feat\.?\s+|\s+featuring\s+|\s+with\s+|\s+x\s+)\s*/i;
    const parts1 = a1.split(splitRegex).map(s => s.trim()).filter(Boolean);
    const parts2 = a2.split(splitRegex).map(s => s.trim()).filter(Boolean);

    for (const p1 of parts1) {
        for (const p2 of parts2) {
            if (p1.length >= 2 && p2.length >= 2) {
                if (p1 === p2 || p1.includes(p2) || p2.includes(p1)) return true;
            }
        }
    }
    return false;
}

function pickBestLrclibMatch(results, queryTitle, queryArtist, actualDuration, isVariation, variationType) {
    if (!results || !Array.isArray(results) || results.length === 0) return null;

    const qT = (queryTitle || "").toLowerCase().trim();
    const qA = (queryArtist || "").toLowerCase().trim();

    // Strict artist filtering: never accept songs by a completely different artist
    const validMatches = results.filter(track => {
        if (!track || !track.artistName) return false;
        return isArtistMatch(track.artistName, qA);
    });

    if (validMatches.length === 0) {
        return null; // Reject false matches from other artists
    }

    const candidates = validMatches;

    let bestTrack = null;
    let bestScore = -9999;

    for (const track of candidates) {
        let score = 0;
        const tName = (track.trackName || "").toLowerCase().trim();
        const aName = (track.artistName || "").toLowerCase().trim();

        if (track.syncedLyrics) {
            score += 100;
        } else if (track.plainLyrics) {
            score += 10;
        } else {
            continue;
        }

        if (aName === qA) score += 40;
        else if (aName.includes(qA) || qA.includes(aName)) score += 25;

        const hasVariationTag = isVariation && variationType && (
            tName.includes(variationType) ||
            (variationType === 'sped up' && (tName.includes('speed up') || tName.includes('speedup') || tName.includes('nightcore') || tName.includes('fast'))) ||
            (variationType === 'slowed' && (tName.includes('reverb') || tName.includes('daycore') || tName.includes('slow')))
        );

        if (isVariation) {
            if (hasVariationTag) {
                score += 160;
            } else {
                score -= 60;
            }
        }

        if (actualDuration > 0 && track.duration > 0) {
            const diff = Math.abs(track.duration - actualDuration);
            if (diff <= 3) score += 120;
            else if (diff <= 6) score += 80;
            else if (diff <= 10) score += 40;
            else if (diff <= 20) score += 10;
            else if (diff > 30) {
                score -= (isVariation ? 90 : 30);
            }
        }

        if (tName === qT) score += 50;
        else if (tName.includes(qT) || qT.includes(tName)) score += 25;

        if (score > bestScore) {
            bestScore = score;
            bestTrack = track;
        }
    }

    return bestTrack;
}

async function getLyrics(title, artist, duration = -1) {
    if (!title) return;
    const requestHash = `${title}-${artist}`;
    currentTrackHash = requestHash;

    const container = document.getElementById('lyrics-container');
    container.innerHTML = '<br><span class="dim">Downloading data packet...</span>';

    const parsed = parseSongTitle(title);
    const cArtist = cleanArtist(artist);
    const hasDuration = typeof duration === 'number' && duration > 0;

    appendLog(`[LYRICS] Requesting sync for: ${title} [${parsed.isVariation ? parsed.variationTag : 'Standard'}]`);

    let savedUnsyncedLyrics = null;

    async function queryProviders(queries, isVarPhase, varType) {
        // Lyrics Plus  
        for (const query of queries) {
            try {
                appendLog(`[LYRICS] Trying Lyrics Plus (${query.t})`);
                const lpData = await withTimeout(
                    fetchLyricsPlusAPI(query.t, query.a, duration),
                    PROVIDER_TIMEOUT_MS,
                    "Lyrics Plus"
                );
                if (currentTrackHash !== requestHash) return 'ABORT';
                if (lpData && lpData.length > 2) {
                    if (lpData.isSynced) {
                        return { data: lpData, provider: "Lyrics Plus" };
                    } else if (!savedUnsyncedLyrics) {
                        savedUnsyncedLyrics = lpData;
                        savedUnsyncedLyrics.sourceName = "Lyrics Plus";
                    }
                }
            } catch (err) {
                console.log(`[Lyrics Plus] Bypassed:`, err.message);
                if (err.message && err.message.includes("timed out")) {
                    appendLog(`[LYRICS] Lyrics Plus timed out (>5s), jumping to next provider`);
                    break;
                }
                if (err.message && (err.message.includes("401") || err.message.includes("403") || err.message.includes("429") || err.message.includes("50"))) {
                    break;
                }
            }
        }

        // Better Lyrics  
        for (const query of queries) {
            try {
                appendLog(`[LYRICS] Trying Better Lyrics (${query.t})`);
                const blData = await withTimeout(
                    fetchBetterLyricsAPI(query.t, query.a, duration),
                    PROVIDER_TIMEOUT_MS,
                    "Better Lyrics"
                );
                if (currentTrackHash !== requestHash) return 'ABORT';
                if (blData && blData.length > 2) {
                    if (blData.isSynced) {
                        return { data: blData, provider: "Better Lyrics" };
                    } else if (!savedUnsyncedLyrics) {
                        savedUnsyncedLyrics = blData;
                        savedUnsyncedLyrics.sourceName = "Better Lyrics";
                    }
                }
            } catch (err) {
                console.log(`[Better Lyrics] Bypassed:`, err.message);
                if (err.message && err.message.includes("timed out")) {
                    appendLog(`[LYRICS] Better Lyrics timed out (>5s), jumping to next provider`);
                    break;
                }
                if (err.message && (err.message.includes("401") || err.message.includes("403") || err.message.includes("429") || err.message.includes("50"))) {
                    break;
                }
            }
        }

        // SimpMusic  
        if (typeof fetchSimpMusicLyricsAPI === 'function') {
            for (const query of queries) {
                try {
                    appendLog(`[LYRICS] Trying SimpMusic (${query.t})`);
                    if (currentTrackHash !== requestHash) return 'ABORT';
                    const smData = await withTimeout(
                        fetchSimpMusicLyricsAPI(query.t, query.a, duration),
                        PROVIDER_TIMEOUT_MS,
                        "SimpMusic"
                    );
                    if (currentTrackHash !== requestHash) return 'ABORT';
                    if (smData && smData.length > 2) {
                        if (smData.isSynced) {
                            return { data: smData, provider: "SimpMusic" };
                        } else if (!savedUnsyncedLyrics) {
                            savedUnsyncedLyrics = smData;
                            savedUnsyncedLyrics.sourceName = "SimpMusic";
                        }
                    }
                } catch (err) {
                    console.log(`[SimpMusic] Bypassed:`, err.message);
                    if (err.message && err.message.includes("timed out")) {
                        appendLog(`[LYRICS] SimpMusic timed out (>5s), jumping to next provider`);
                        break;
                    }
                }
            }
        }

        // Lrclib exact get  
        for (const query of queries) {
            try {
                appendLog(`[LYRICS] Trying Lrclib Exact (${query.t})`);
                if (currentTrackHash !== requestHash) return 'ABORT';
                const params = new URLSearchParams({
                    artist_name: query.a,
                    track_name: query.t
                });
                const response = await withTimeout(
                    fetch(`https://lrclib.net/api/get?${params.toString()}`),
                    PROVIDER_TIMEOUT_MS,
                    "Lrclib Exact"
                );
                if (response.ok) {
                    const data = await response.json();
                    if (data && data.artistName && !isArtistMatch(data.artistName, query.a)) {
                        continue;
                    }
                    if (data.syncedLyrics) {
                        const parsedLrc = parseLRC(data.syncedLyrics);
                        if (data.duration) parsedLrc.originalDuration = data.duration;
                        return { data: parsedLrc, provider: "Lrclib" };
                    } else if (data.plainLyrics && !savedUnsyncedLyrics) {
                        savedUnsyncedLyrics = data.plainLyrics.split('\n').map(line => ({ time: 0, text: line }));
                        savedUnsyncedLyrics.isSynced = false;
                        savedUnsyncedLyrics.sourceName = "Lrclib";
                    }
                }
            } catch (err) {
                if (err.message && err.message.includes("timed out")) {
                    appendLog(`[LYRICS] Lrclib Exact timed out (>5s), jumping to next`);
                }
                break;
            }
        }

        // Lrclib search  
        for (const query of queries) {
            try {
                appendLog(`[LYRICS] Trying Lrclib Search (${query.t})`);
                if (currentTrackHash !== requestHash) return 'ABORT';
                const params = new URLSearchParams({ q: query.t });
                const response = await withTimeout(
                    fetch(`https://lrclib.net/api/search?${params.toString()}`),
                    PROVIDER_TIMEOUT_MS,
                    "Lrclib Search"
                );
                if (response.ok) {
                    const results = await response.json();
                    const bestMatch = pickBestLrclibMatch(results, query.t, query.a, duration, isVarPhase, varType);
                    
                    if (bestMatch) {
                        if (isVarPhase) {
                            const tName = (bestMatch.trackName || "").toLowerCase();
                            const matchesVar = varType && (
                                tName.includes(varType) ||
                                (varType === 'sped up' && (tName.includes('speed up') || tName.includes('speedup') || tName.includes('nightcore') || tName.includes('fast'))) ||
                                (varType === 'slowed' && (tName.includes('reverb') || tName.includes('daycore') || tName.includes('slow')))
                            );
                            const matchesDur = hasDuration && bestMatch.duration && Math.abs(bestMatch.duration - duration) <= 10;
                            if (!matchesVar && !matchesDur) {
                                continue;
                            }
                        }

                        if (bestMatch.syncedLyrics) {
                            const parsedLrc = parseLRC(bestMatch.syncedLyrics);
                            if (bestMatch.duration) parsedLrc.originalDuration = bestMatch.duration;
                            return { data: parsedLrc, provider: "Lrclib" };
                        } else if (bestMatch.plainLyrics && !savedUnsyncedLyrics) {
                            savedUnsyncedLyrics = bestMatch.plainLyrics.split('\n').map(line => ({ time: 0, text: line }));
                            savedUnsyncedLyrics.isSynced = false;
                            savedUnsyncedLyrics.sourceName = "Lrclib";
                        }
                    }
                }
            } catch (err) {
                if (err.message && err.message.includes("timed out")) {
                    appendLog(`[LYRICS] Lrclib Search timed out (>5s), jumping to KuGou`);
                }
                break;
            }
        }

        // KuGou  
        for (const query of queries) {
            try {
                appendLog(`[LYRICS] Trying KuGou (${query.t})`);
                if (currentTrackHash !== requestHash) return 'ABORT';
                const kgData = await withTimeout(
                    fetchKugouLyricsAPI(query.t, query.a, duration),
                    PROVIDER_TIMEOUT_MS,
                    "KuGou"
                );
                if (kgData) {
                    const strData = String(kgData);
                    if (strData.includes("纯音乐") || strData.includes("请欣赏")) {
                        if (!savedUnsyncedLyrics) savedUnsyncedLyrics = "Instrumental";
                        continue;
                    }

                    const parsedLrc = parseLRC(strData);
                    if (parsedLrc && parsedLrc.length > 2) {
                        if (kgData.duration && kgData.duration > 0) {
                            parsedLrc.originalDuration = kgData.duration;
                        }
                        return { data: parsedLrc, provider: "KuGou" };
                    }
                }
            } catch (err) {
                if (err.message && err.message.includes("timed out")) {
                    appendLog(`[LYRICS] KuGou timed out (>5s), finishing search`);
                }
                break;
            }
        }

        return null;
    }

    let result = null;

    //If it's a variation, attempt to find lyrics specifically for this variation
    if (parsed.isVariation) {
        const varQueries = [
            { t: title, a: artist },
            { t: `${parsed.baseTitle} (${parsed.variationTag})`, a: artist },
            { t: `${parsed.baseTitle} - ${parsed.variationTag}`, a: artist },
            { t: `${parsed.baseTitle} (${parsed.variationTag})`, a: cArtist },
            { t: `${parsed.baseTitle} - ${parsed.variationTag}`, a: cArtist }
        ];
        if (parsed.variationType === 'sped up' && !parsed.variationTag.toLowerCase().includes('version')) {
            varQueries.push({ t: `${parsed.baseTitle} (${parsed.variationTag} Version)`, a: artist });
        }

        const uniqueVarQueries = varQueries.filter((q, index, self) =>
            index === self.findIndex(t => t.t.toLowerCase() === q.t.toLowerCase() && t.a.toLowerCase() === q.a.toLowerCase())
        );

        result = await queryProviders(uniqueVarQueries, true, parsed.variationType);
        if (result === 'ABORT') return;
    }

    // If no variation was found OR if it's a standard track, search for base song
    if (!result) {
        const baseQueries = [
            { t: parsed.baseTitle, a: artist },
            { t: parsed.baseTitle, a: cArtist }
        ];
        if (!parsed.isVariation && title !== parsed.baseTitle) {
            baseQueries.unshift({ t: title, a: artist });
        }

        const uniqueBaseQueries = baseQueries.filter((q, index, self) =>
            index === self.findIndex(t => t.t.toLowerCase() === q.t.toLowerCase() && t.a.toLowerCase() === q.a.toLowerCase())
        );

        result = await queryProviders(uniqueBaseQueries, false, null);
        if (result === 'ABORT') return;

        // If found lyrics for a variation track, apply automatic time-scaling
        if (result && result.data && parsed.isVariation && (parsed.variationType === 'sped up' || parsed.variationType === 'slowed') && hasDuration) {
            let origDur = result.data.originalDuration;
            if (!origDur || origDur <= 0) {
                const lastLine = result.data.filter(l => l.time < 9000).pop();
                if (lastLine && lastLine.time > 10) {
                    origDur = lastLine.time / 0.88;
                }
            }

            if (origDur && origDur > 10) {
                const factor = duration / origDur;
                if (factor >= 0.4 && factor <= 2.2 && (factor <= 0.95 || factor >= 1.05)) {
                    result.data = scaleLyrics(result.data, factor);
                    const speedRatio = (1 / factor).toFixed(2);
                    const label = factor < 1 ? `Sped Up ${speedRatio}x` : `Slowed ${speedRatio}x`;
                    result.provider += ` (Auto-scaled ${label})`;
                    appendLog(`[LYRICS] Scaled timestamps to fit: ${label}`);
                }
            }
        }
    }

    if (result && result.data) {
        currentLyricsData = result.data;
        currentLyricsData.provider = result.provider;
        currentLyricsData.isSynced = true;
        appendLog(`[LYRICS] Success via ${currentLyricsData.provider}`);
        renderLyricsToDom();
        return;
    }

    // Fallback to unsynced if found
    if (savedUnsyncedLyrics) {
        currentLyricsData = savedUnsyncedLyrics;
        currentLyricsData.provider = `${savedUnsyncedLyrics.sourceName} (Unsynced)`;
        appendLog(`[LYRICS] Success via ${currentLyricsData.provider}`);
        renderLyricsToDom();
        return;
    }

    container.innerHTML = '<br><span class="dim">No lyrics found.</span>';
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
    cleanedText = cleanedText.replace(/\s*-\s*(?:(?:\d{4}\s*)?remaster(?:ed)?(?:\s*\d{4})?|digitally\s*remastered|deluxe\s*(?:edition|version)|anniversary\s*edition|original\s*mix|album\s*version).*$/gi, '');

    // Replace double spaces with a single space and trim
    return cleanedText.replace(/\s+/g, ' ').trim();
}

function cleanArtist(artist) {
    if (!artist) return ""; // Protect against undefined/null
    return String(artist).split(/,|&|\+| and | ft\.? | feat\.? | featuring /i)[0].trim();
}
