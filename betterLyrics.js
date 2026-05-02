/**
 * Parses TTML time strings into decimal seconds.
 * Handles "HH:MM:SS.mmm", "M:SS.mmm", and "SS.mmm"
 */
function parseTTMLTimeToSeconds(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.split(':');
    let seconds = 0;

    if (parts.length === 3) {
        seconds = parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
    } else if (parts.length === 2) {
        seconds = parseInt(parts[0]) * 60 + parseFloat(parts[1]);
    } else {
        seconds = parseFloat(parts[0]);
    }
    
    return seconds; // Kept as decimal seconds to match your main app's sync logic
}

function parseTTML(ttmlString) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(ttmlString, 'text/xml');
    const result = [];

    // Add your UI start padding
    result.push({ time: 0, text: ' ' });

    doc.querySelectorAll('p').forEach(p => {
        let fullLineText = "";
        const words = []; // Syllable data (saved for future upgrades)

        // Recursively collect spans, tracking text and syllables
        function collectSpans(element, isBackground = false) {
            element.childNodes.forEach(node => {
                if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'span') {
                    const isBg = isBackground || node.getAttribute('ttm:role') === 'x-bg';
                    const begin = node.getAttribute('begin');

                    if (begin) {
                        // Crucial: preserve the raw text content (including trailing spaces)
                        fullLineText += node.textContent; 
                        
                        words.push({
                            text: node.textContent,
                            time: parseTTMLTimeToSeconds(begin),
                            isBackground: isBg
                        });
                    } else {
                        // Wrapper span, recurse
                        collectSpans(node, isBg);
                    }
                }
            });
        }

        collectSpans(p);

        const lineBeginTime = p.getAttribute('begin');
        
        // Only add non-empty lines
        if (lineBeginTime && fullLineText.trim() !== "") {
            result.push({
                time: parseTTMLTimeToSeconds(lineBeginTime),
                text: fullLineText, 
                words: words // Store syllable data silently in the background
            });
        }
    });

    // Add your UI end padding
    result.push({ time: 9999, text: ' ' });
    return result;
}

async function fetchBetterLyricsAPI(title, artist) {
    const params = new URLSearchParams({
        s: title,
        a: artist
    });
    const url = `https://lyrics-api.boidu.dev/getLyrics?${params.toString()}`;
    console.log(`[Better Lyrics] Fetching: ${url}`);
    const response = await fetch(url);
    
    if (!response.ok) {
        throw new Error(`Better Lyrics HTTP Error: ${response.status}`);
    }

    const data = await response.json();

    // Check for Primary TTML format
    if (data.ttml) {
        return parseTTML(data.ttml);
    } 
    // Check for Fallback Kugou format (Standard LRC)
    else if (data.lyrics && typeof parseLRC === 'function') {
        // If the API serves Kugou, it's normal LRC format, 
        // so we reuse your existing parseLRC function from the main file.
        return parseLRC(data.lyrics);
    }

    throw new Error("No valid sync format returned from Better Lyrics");
}