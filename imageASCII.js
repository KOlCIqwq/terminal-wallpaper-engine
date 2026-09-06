const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

const asciiOutput = document.getElementById('asciiOutput');
const asciiCtx = asciiOutput.getContext('2d');

const density = "Ñ@#W$9876543210?!abc;:+=-,._ ";
const densityLen = density.length - 1;

// Matrix character pool: cyber runes, numbers, letters, half-width katakana
const MATRIX_CHARS = "0123456789ABCDEF:;*+-<>~/$#&%ｦｱｳｴｵｶｷｹｺｻｼｽｾｿﾀﾂﾃﾅﾆﾇﾈﾊﾋﾎﾏﾐﾑﾒﾓﾔﾕﾗﾘﾜ";
const MATRIX_CHARS_LEN = MATRIX_CHARS.length;

let currentImageSize = 500;
let currentFontSize = 8;
let currentThumbnailBase64 = null;
let currentTransitionStyle = 'rain'; // 'rain', 'glitch', 'none'
let currentTransitionColor = 'dynamic'; // 'dynamic', 'chromatic', 'green', 'cyan', 'amber', 'violet'
let currentTransitionDuration = 1200; // ms

let activeGrid = null;
let activeAnimationId = null;

// AsciiGrid representation: flat typed arrays for zero-GC 60fps rendering
class AsciiGrid {
    constructor(width, height, charWidth, charHeight) {
        this.width = width;
        this.height = height;
        this.charWidth = charWidth;
        this.charHeight = charHeight;
        this.pixelWidth = width * charWidth;
        this.pixelHeight = height * charHeight;
        const size = width * height;
        this.chars = new Array(size);
        this.r = new Uint8Array(size);
        this.g = new Uint8Array(size);
        this.b = new Uint8Array(size);
        this.brightness = new Uint8Array(size);
        this.active = new Uint8Array(size);
        this.accentR = 0;
        this.accentG = 230;
        this.accentB = 140;
    }
}

function cancelCurrentTransition() {
    if (activeAnimationId) {
        cancelAnimationFrame(activeAnimationId);
        activeAnimationId = null;
    }
}

function createAsciiGridFromImage(img, targetWidthPixels, fontSize) {
    const charWidth = fontSize * 0.6;
    const charHeight = fontSize * 0.65;
    
    const asciiWidth = Math.max(1, Math.floor(targetWidthPixels / charWidth));
    const scaleFactor = asciiWidth / img.width;
    const asciiHeight = Math.max(1, Math.floor(img.height * scaleFactor));

    canvas.width = asciiWidth;
    canvas.height = asciiHeight;
    ctx.drawImage(img, 0, 0, asciiWidth, asciiHeight);

    const imageData = ctx.getImageData(0, 0, asciiWidth, asciiHeight);
    const pixels = imageData.data;
    
    const grid = new AsciiGrid(asciiWidth, asciiHeight, charWidth, charHeight);

    let totalSatWeight = 0;
    let accR = 0, accG = 0, accB = 0;

    for (let y = 0; y < asciiHeight; y++) {
        for (let x = 0; x < asciiWidth; x++) {
            const idx = y * asciiWidth + x;
            const offset = idx * 4;
            const r = pixels[offset];
            const g = pixels[offset + 1];
            const b = pixels[offset + 2];
            const a = pixels[offset + 3];

            if (a < 25) {
                grid.chars[idx] = " ";
                grid.active[idx] = 0;
                continue;
            }

            const brightness = Math.floor((r * 299 + g * 587 + b * 114) / 1000);
            const charIndex = Math.floor((brightness / 255) * densityLen);
            const char = density[charIndex];

            grid.chars[idx] = char;
            grid.r[idx] = r;
            grid.g[idx] = g;
            grid.b[idx] = b;
            grid.brightness[idx] = brightness;
            grid.active[idx] = (char !== " ") ? 1 : 0;

            const maxC = Math.max(r, g, b);
            const minC = Math.min(r, g, b);
            const sat = maxC - minC;
            if (sat > 20 && maxC > 50) {
                const weight = sat * sat;
                accR += r * weight;
                accG += g * weight;
                accB += b * weight;
                totalSatWeight += weight;
            }
        }
    }

    if (totalSatWeight > 0) {
        let baseR = Math.round(accR / totalSatWeight);
        let baseG = Math.round(accG / totalSatWeight);
        let baseB = Math.round(accB / totalSatWeight);
        const maxV = Math.max(baseR, baseG, baseB, 1);
        if (maxV < 210) {
            const boost = 210 / maxV;
            baseR = Math.min(255, Math.round(baseR * boost));
            baseG = Math.min(255, Math.round(baseG * boost));
            baseB = Math.min(255, Math.round(baseB * boost));
        }
        grid.accentR = baseR;
        grid.accentG = baseG;
        grid.accentB = baseB;
    } else {
        grid.accentR = 20;
        grid.accentG = 225;
        grid.accentB = 255;
    }

    return grid;
}

function computeThemeColor(mode, progress, oldGrid, newGrid, oldR, oldG, oldB, newR, newG, newB) {
    if (mode === 'chromatic') {
        const r = Math.round(oldR * (1 - progress) + newR * progress);
        const g = Math.round(oldG * (1 - progress) + newG * progress);
        const b = Math.round(oldB * (1 - progress) + newB * progress);
        const maxVal = Math.max(r, g, b, 1);
        const boost = maxVal < 180 ? 180 / maxVal : 1;
        return {
            r: Math.min(255, Math.round(r * boost)),
            g: Math.min(255, Math.round(g * boost)),
            b: Math.min(255, Math.round(b * boost))
        };
    }
    if (mode === 'green') return { r: 30, g: 245, b: 70 };
    if (mode === 'cyan') return { r: 20, g: 225, b: 255 };
    if (mode === 'amber') return { r: 255, g: 175, b: 25 };
    if (mode === 'violet') return { r: 220, g: 60, b: 255 };

    // 'dynamic' (default): morph from old album accent to new album accent
    const oR = (oldGrid && oldGrid.accentR !== undefined) ? oldGrid.accentR : 0;
    const oG = (oldGrid && oldGrid.accentG !== undefined) ? oldGrid.accentG : 230;
    const oB = (oldGrid && oldGrid.accentB !== undefined) ? oldGrid.accentB : 140;

    const nR = (newGrid && newGrid.accentR !== undefined) ? newGrid.accentR : 0;
    const nG = (newGrid && newGrid.accentG !== undefined) ? newGrid.accentG : 230;
    const nB = (newGrid && newGrid.accentB !== undefined) ? newGrid.accentB : 140;

    return {
        r: Math.round(oR * (1 - progress) + nR * progress),
        g: Math.round(oG * (1 - progress) + nG * progress),
        b: Math.round(oB * (1 - progress) + nB * progress)
    };
}

function computeHeadColor(theme) {
    return {
        r: Math.min(255, Math.round(theme.r * 0.35 + 255 * 0.65)),
        g: Math.min(255, Math.round(theme.g * 0.35 + 255 * 0.65)),
        b: Math.min(255, Math.round(theme.b * 0.35 + 255 * 0.65))
    };
}

function renderGridInstantly(grid) {
    asciiOutput.width = grid.pixelWidth;
    asciiOutput.height = grid.pixelHeight;
    
    asciiCtx.clearRect(0, 0, asciiOutput.width, asciiOutput.height);
    asciiCtx.font = 'bold ' + currentFontSize + 'px Consolas, "Courier New", monospace';
    asciiCtx.textBaseline = 'top';

    let lastFill = "";
    for (let y = 0; y < grid.height; y++) {
        const py = y * grid.charHeight;
        for (let x = 0; x < grid.width; x++) {
            const idx = y * grid.width + x;
            if (!grid.active[idx]) continue;

            const fill = 'rgb(' + grid.r[idx] + ',' + grid.g[idx] + ',' + grid.b[idx] + ')';
            if (fill !== lastFill) {
                asciiCtx.fillStyle = fill;
                lastFill = fill;
            }
            asciiCtx.fillText(grid.chars[idx], x * grid.charWidth, py);
        }
    }
}

function runRainTransition(oldGrid, newGrid, duration, startTime) {
    const cols = newGrid.width;
    const rows = newGrid.height;
    
    const colDelays = new Float32Array(cols);
    const colSpeeds = new Float32Array(cols);
    const colTrails = new Uint8Array(cols);

    for (let x = 0; x < cols; x++) {
        colDelays[x] = Math.random() * 0.35;
        colSpeeds[x] = 0.85 + Math.random() * 0.35;
        colTrails[x] = 10 + Math.floor(Math.random() * 8);
    }

    function frame(now) {
        const elapsed = now - startTime;
        const progress = Math.min(1, elapsed / duration);

        asciiCtx.clearRect(0, 0, asciiOutput.width, asciiOutput.height);
        asciiCtx.font = 'bold ' + currentFontSize + 'px Consolas, "Courier New", monospace';
        asciiCtx.textBaseline = 'top';

        const frameSeed = (elapsed / 45) | 0;
        let lastFill = "";

        const globalTheme = computeThemeColor(currentTransitionColor, progress, oldGrid, newGrid, 0, 0, 0, 0, 0, 0);
        const globalHead = computeHeadColor(globalTheme);

        for (let x = 0; x < cols; x++) {
            const delay = colDelays[x];
            const speed = colSpeeds[x];
            const trail = colTrails[x];

            const tCol = Math.max(0, Math.min(1, (progress - delay) / (0.65 * speed)));
            const headY = tCol * (rows + trail + 6) - 4;
            const px = x * newGrid.charWidth;

            for (let y = 0; y < rows; y++) {
                const newIdx = y * cols + x;
                const py = y * newGrid.charHeight;

                const oldX = Math.floor(x * (oldGrid.width / cols));
                const oldY = Math.floor(y * (oldGrid.height / rows));
                const oldIdx = oldY * oldGrid.width + oldX;

                const hasOld = oldGrid.active[oldIdx];
                const hasNew = newGrid.active[newIdx];
                if (!hasOld && !hasNew) continue;

                let char = " ";
                let r = 0, g = 0, b = 0;

                let cellTheme = globalTheme;
                let cellHead = globalHead;
                if (currentTransitionColor === 'chromatic') {
                    cellTheme = computeThemeColor('chromatic', progress, oldGrid, newGrid,
                        hasOld ? oldGrid.r[oldIdx] : 100, hasOld ? oldGrid.g[oldIdx] : 100, hasOld ? oldGrid.b[oldIdx] : 100,
                        hasNew ? newGrid.r[newIdx] : 100, hasNew ? newGrid.g[newIdx] : 100, hasNew ? newGrid.b[newIdx] : 100
                    );
                    cellHead = computeHeadColor(cellTheme);
                }

                if (y > headY + 2) {
                    // Zone 1: Unreached - old image intact
                    if (!hasOld) continue;
                    char = oldGrid.chars[oldIdx];
                    r = oldGrid.r[oldIdx];
                    g = oldGrid.g[oldIdx];
                    b = oldGrid.b[oldIdx];
                } else if (y >= headY - 1 && y <= headY + 2) {
                    // Zone 2: Rain Head - old image breaks into glowing cyber glyph
                    char = MATRIX_CHARS[(x * 31 + y * 17 + frameSeed) % MATRIX_CHARS_LEN];
                    r = cellHead.r;
                    g = cellHead.g;
                    b = cellHead.b;
                } else if (y >= headY - trail && y < headY - 1) {
                    // Zone 3: Cyber Rain Stream
                    const dist = (headY - 1) - y;
                    const trailRatio = dist / trail;

                    char = MATRIX_CHARS[(x * 23 + y * 43 + frameSeed) % MATRIX_CHARS_LEN];

                    const lum = hasNew ? newGrid.brightness[newIdx] : (hasOld ? oldGrid.brightness[oldIdx] : 120);
                    const lumFactor = 0.35 + 0.65 * (lum / 255);
                    const trailFactor = 1 - 0.45 * trailRatio;

                    r = Math.round(cellTheme.r * trailFactor * lumFactor);
                    g = Math.round(cellTheme.g * trailFactor * lumFactor);
                    b = Math.round(cellTheme.b * trailFactor * lumFactor);
                } else {
                    // Zone 4: Recomposition Zone behind the trail
                    if (!hasNew) continue;
                    const distPastTrail = (headY - trail) - y;
                    const rebuild = Math.min(1, distPastTrail / 7);

                    const targetR = newGrid.r[newIdx];
                    const targetG = newGrid.g[newIdx];
                    const targetB = newGrid.b[newIdx];

                    if (rebuild < 0.6) {
                        char = (rebuild > 0.3 && ((x + y + frameSeed) % 2 === 0))
                            ? newGrid.chars[newIdx]
                            : MATRIX_CHARS[(x * 19 + y * 29 + frameSeed) % MATRIX_CHARS_LEN];

                        r = Math.round(cellTheme.r * (1 - rebuild) + targetR * rebuild);
                        g = Math.round(cellTheme.g * (1 - rebuild) + targetG * rebuild);
                        b = Math.round(cellTheme.b * (1 - rebuild) + targetB * rebuild);
                    } else {
                        char = newGrid.chars[newIdx];
                        const bloom = (rebuild - 0.6) / 0.4;
                        r = Math.round(targetR * (0.75 + 0.25 * bloom));
                        g = Math.round(targetG * (0.75 + 0.25 * bloom));
                        b = Math.round(targetB * (0.75 + 0.25 * bloom));
                    }
                }

                if (char !== " ") {
                    const fill = 'rgb(' + r + ',' + g + ',' + b + ')';
                    if (fill !== lastFill) {
                        asciiCtx.fillStyle = fill;
                        lastFill = fill;
                    }
                    asciiCtx.fillText(char, px, py);
                }
            }
        }

        if (progress < 1) {
            activeAnimationId = requestAnimationFrame(frame);
        } else {
            activeAnimationId = null;
            renderGridInstantly(newGrid);
        }
    }

    activeAnimationId = requestAnimationFrame(frame);
}

function runGlitchTransition(oldGrid, newGrid, duration, startTime) {
    const cols = newGrid.width;
    const rows = newGrid.height;
    const totalCells = cols * rows;

    const breakThresholds = new Float32Array(totalCells);
    const rebuildThresholds = new Float32Array(totalCells);

    for (let i = 0; i < totalCells; i++) {
        breakThresholds[i] = Math.random() * 0.32;
        rebuildThresholds[i] = Math.random() * 0.35;
    }

    function frame(now) {
        const elapsed = now - startTime;
        const progress = Math.min(1, elapsed / duration);

        asciiCtx.clearRect(0, 0, asciiOutput.width, asciiOutput.height);
        asciiCtx.font = 'bold ' + currentFontSize + 'px Consolas, "Courier New", monospace';
        asciiCtx.textBaseline = 'top';

        const frameSeed = (elapsed / 45) | 0;
        let lastFill = "";

        const globalTheme = computeThemeColor(currentTransitionColor, progress, oldGrid, newGrid, 0, 0, 0, 0, 0, 0);
        const globalHead = computeHeadColor(globalTheme);

        const hasScanlineGlitch = (frameSeed % 7 === 0) && progress < 0.8;
        const glitchRow = hasScanlineGlitch ? ((frameSeed * 13) % rows) : -1;
        const glitchShift = hasScanlineGlitch ? (((frameSeed % 3) - 1) * newGrid.charWidth * 1.5) : 0;

        for (let y = 0; y < rows; y++) {
            const py = y * newGrid.charHeight;
            const isGlitchLine = (y === glitchRow);

            for (let x = 0; x < cols; x++) {
                const newIdx = y * cols + x;
                const px = x * newGrid.charWidth + (isGlitchLine ? glitchShift : 0);

                const oldX = Math.floor(x * (oldGrid.width / cols));
                const oldY = Math.floor(y * (oldGrid.height / rows));
                const oldIdx = oldY * oldGrid.width + oldX;

                const hasOld = oldGrid.active[oldIdx];
                const hasNew = newGrid.active[newIdx];
                if (!hasOld && !hasNew) continue;

                let char = " ";
                let r = 0, g = 0, b = 0;

                let cellTheme = globalTheme;
                let cellHead = globalHead;
                if (currentTransitionColor === 'chromatic') {
                    cellTheme = computeThemeColor('chromatic', progress, oldGrid, newGrid,
                        hasOld ? oldGrid.r[oldIdx] : 100, hasOld ? oldGrid.g[oldIdx] : 100, hasOld ? oldGrid.b[oldIdx] : 100,
                        hasNew ? newGrid.r[newIdx] : 100, hasNew ? newGrid.g[newIdx] : 100, hasNew ? newGrid.b[newIdx] : 100
                    );
                    cellHead = computeHeadColor(cellTheme);
                }

                if (progress < 0.35) {
                    const t1 = progress / 0.35;
                    const breakThresh = breakThresholds[newIdx];

                    if (t1 < breakThresh) {
                        if (!hasOld) continue;
                        char = oldGrid.chars[oldIdx];
                        r = oldGrid.r[oldIdx];
                        g = oldGrid.g[oldIdx];
                        b = oldGrid.b[oldIdx];
                    } else {
                        const localBreak = (t1 - breakThresh) / (1 - breakThresh + 0.001);
                        char = MATRIX_CHARS[(x * 19 + y * 31 + frameSeed) % MATRIX_CHARS_LEN];

                        const oldR = hasOld ? oldGrid.r[oldIdx] : 0;
                        const oldG = hasOld ? oldGrid.g[oldIdx] : cellTheme.g;
                        const oldB = hasOld ? oldGrid.b[oldIdx] : cellTheme.b;

                        r = Math.round(oldR * (1 - localBreak) + cellTheme.r * localBreak);
                        g = Math.round(oldG * (1 - localBreak) + cellTheme.g * localBreak);
                        b = Math.round(oldB * (1 - localBreak) + cellTheme.b * localBreak);
                    }
                } else if (progress <= 0.65) {
                    const t2 = (progress - 0.35) / 0.30;
                    char = MATRIX_CHARS[(x * 23 + y * 37 + frameSeed) % MATRIX_CHARS_LEN];

                    const bOld = hasOld ? oldGrid.brightness[oldIdx] : 100;
                    const bNew = hasNew ? newGrid.brightness[newIdx] : 100;
                    const lum = bOld * (1 - t2) + bNew * t2;
                    const intensity = 0.35 + 0.65 * (lum / 255);

                    if ((x * 17 + y * 29 + frameSeed) % 31 === 0) {
                        r = cellHead.r; g = cellHead.g; b = cellHead.b;
                    } else {
                        r = Math.round(cellTheme.r * intensity);
                        g = Math.round(cellTheme.g * intensity);
                        b = Math.round(cellTheme.b * intensity);
                    }
                } else {
                    const t3 = (progress - 0.65) / 0.35;
                    const rebuildThresh = rebuildThresholds[newIdx];

                    if (t3 < rebuildThresh) {
                        char = MATRIX_CHARS[(x * 29 + y * 13 + frameSeed) % MATRIX_CHARS_LEN];
                        const lum = hasNew ? newGrid.brightness[newIdx] : 120;
                        const intensity = 0.35 + 0.65 * (lum / 255);
                        r = Math.round(cellTheme.r * intensity);
                        g = Math.round(cellTheme.g * intensity);
                        b = Math.round(cellTheme.b * intensity);
                    } else {
                        if (!hasNew) continue;
                        char = newGrid.chars[newIdx];
                        const bloom = (t3 - rebuildThresh) / (1 - rebuildThresh + 0.001);

                        const targetR = newGrid.r[newIdx];
                        const targetG = newGrid.g[newIdx];
                        const targetB = newGrid.b[newIdx];

                        r = Math.round(cellTheme.r * (1 - bloom) + targetR * bloom);
                        g = Math.round(cellTheme.g * (1 - bloom) + targetG * bloom);
                        b = Math.round(cellTheme.b * (1 - bloom) + targetB * bloom);
                    }
                }

                if (char !== " ") {
                    const fill = 'rgb(' + r + ',' + g + ',' + b + ')';
                    if (fill !== lastFill) {
                        asciiCtx.fillStyle = fill;
                        lastFill = fill;
                    }
                    asciiCtx.fillText(char, px, py);
                }
            }
        }

        if (progress < 1) {
            activeAnimationId = requestAnimationFrame(frame);
        } else {
            activeAnimationId = null;
            renderGridInstantly(newGrid);
        }
    }

    activeAnimationId = requestAnimationFrame(frame);
}

function startTransition(oldGrid, newGrid, style, duration) {
    cancelCurrentTransition();
    activeGrid = newGrid;

    asciiOutput.width = newGrid.pixelWidth;
    asciiOutput.height = newGrid.pixelHeight;

    const startTime = performance.now();

    if (style === 'glitch') {
        runGlitchTransition(oldGrid, newGrid, duration, startTime);
    } else {
        runRainTransition(oldGrid, newGrid, duration, startTime);
    }
}

window.myPropertyHandlers = window.myPropertyHandlers || [];

if (!window.wallpaperPropertyListener) {
    window.wallpaperPropertyListener = {
        applyUserProperties: function(properties) {
            window.myPropertyHandlers.forEach(handler => handler(properties));
        }
    };
}

window.myPropertyHandlers.push(function(properties) {
    let redrawNeeded = false;

    if (properties.ascii_image_size) {
        currentImageSize = parseInt(properties.ascii_image_size.value);
        redrawNeeded = true;
    }
    if (properties.ascii_fontsize) {
        currentFontSize = parseInt(properties.ascii_fontsize.value); 
        redrawNeeded = true;
    }
    if (properties.ascii_transition_effect) {
        const val = properties.ascii_transition_effect.value;
        if (typeof val === 'string') {
            currentTransitionStyle = val;
        } else if (typeof val === 'number') {
            const styles = ['rain', 'glitch', 'none'];
            currentTransitionStyle = styles[val] || 'rain';
        }
    }
    if (properties.ascii_transition_color) {
        const val = properties.ascii_transition_color.value;
        if (typeof val === 'string') {
            currentTransitionColor = val;
        } else if (typeof val === 'number') {
            const colors = ['dynamic', 'chromatic', 'green', 'cyan', 'amber', 'violet'];
            currentTransitionColor = colors[val] || 'dynamic';
        }
    }
    if (properties.ascii_transition_duration) {
        const val = parseFloat(properties.ascii_transition_duration.value);
        if (!isNaN(val) && val > 0) {
            currentTransitionDuration = val < 10 ? Math.round(val * 1000) : Math.round(val);
        }
    }

    if (redrawNeeded && currentThumbnailBase64) {
        generateAscii(currentThumbnailBase64, true);
    }
});

// Single listener for Track/Thumbnail Changes
if (window.wallpaperRegisterMediaThumbnailListener) {
    window.wallpaperRegisterMediaThumbnailListener((event) => {
    if (event.thumbnail) {
        if (event.thumbnail === currentThumbnailBase64) return;
        currentThumbnailBase64 = event.thumbnail;
        generateAscii(currentThumbnailBase64);

        if (!window.useCustomColors) {
            extractAndApplyColors(currentThumbnailBase64);
        }
    } else {
        cancelCurrentTransition();
        asciiCtx.clearRect(0, 0, asciiOutput.width, asciiOutput.height);
        currentThumbnailBase64 = null;
        activeGrid = null;
    }
    });
}

// expose the function to reapply the colors
window.reapplyDynamicColors = function() {
    if (currentThumbnailBase64) {
        extractAndApplyColors(currentThumbnailBase64);
    }
};

function generateAscii(base64Image, instant = false) {
    if (typeof appendLog === 'function') {
        appendLog('[IMAGE] Generating ASCII image');
    }
    const asciiImg = new Image();

    asciiImg.onload = () => {
        const newGrid = createAsciiGridFromImage(asciiImg, currentImageSize, currentFontSize);

        if (instant || currentTransitionStyle === 'none' || currentTransitionDuration <= 0 || !activeGrid) {
            cancelCurrentTransition();
            renderGridInstantly(newGrid);
            activeGrid = newGrid;
            return;
        }

        startTransition(activeGrid, newGrid, currentTransitionStyle, currentTransitionDuration);
    };

    asciiImg.src = base64Image;
}
window.generateAscii = generateAscii;

function extractAndApplyColors(base64Image) {
    if (typeof appendLog === 'function') {
        appendLog('[IMAGE] Extracting colors');
    }
    const img = new Image();

    img.onload = () => {
        const sampleCanvas = document.createElement('canvas');
        const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });
        
        sampleCanvas.width = 64;
        sampleCanvas.height = 64;
        sampleCtx.drawImage(img, 0, 0, 64, 64);

        const imageData = sampleCtx.getImageData(0, 0, 64, 64);
        const data = imageData.data;

        // Structural colors (Brightness)
        let darks = { r: 0, g: 0, b: 0, count: 0 };
        let mids = { r: 0, g: 0, b: 0, count: 0 };
        let lights = { r: 0, g: 0, b: 0, count: 0 };

        // Accent colors (Hue)
        let reds = { r: 0, g: 0, b: 0, count: 0 };
        let yellows = { r: 0, g: 0, b: 0, count: 0 };
        let greens = { r: 0, g: 0, b: 0, count: 0 };
        let blues = { r: 0, g: 0, b: 0, count: 0 };
        let grays = { r: 0, g: 0, b: 0, count: 0 };

        for (let i = 0; i < data.length; i += 4) {
            let r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
            
            if (a < 128) continue; 
            
            // Structural Luminance
            let luminance = (0.299 * r + 0.587 * g + 0.114 * b);
            if (luminance < 85) {
                darks.r += r; darks.g += g; darks.b += b; darks.count++;
            } else if (luminance < 170) {
                mids.r += r; mids.g += g; mids.b += b; mids.count++;
            } else {
                lights.r += r; lights.g += g; lights.b += b; lights.count++;
            }

            // Convert RGB to HSL for Accent Colors
            let rNorm = r / 255, gNorm = g / 255, bNorm = b / 255;
            let max = Math.max(rNorm, gNorm, bNorm), min = Math.min(rNorm, gNorm, bNorm);
            let h = 0, s = 0, l = (max + min) / 2;

            if (max !== min) {
                let d = max - min;
                s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
                switch(max) {
                    case rNorm: h = (gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0); break;
                    case gNorm: h = (bNorm - rNorm) / d + 2; break;
                    case bNorm: h = (rNorm - gNorm) / d + 4; break;
                }
                h /= 6;
            }
            
            h = Math.round(h * 360); // 0 to 360 degrees
            s = Math.round(s * 100); // 0% to 100%
            l = Math.round(l * 100); // 0% to 100%

            // Group pixels into Hue buckets (skip pitch black/pure white)
            if (l > 15 && l < 85) {
                if (s <= 20) {
                    // Low saturation = Gray
                    grays.r += r; grays.g += g; grays.b += b; grays.count++;
                } else {
                    // High saturation = Vibrant Accents
                    if (h < 40 || h >= 330) {
                        reds.r += r; reds.g += g; reds.b += b; reds.count++;
                    } else if (h >= 40 && h < 90) {
                        yellows.r += r; yellows.g += g; yellows.b += b; yellows.count++;
                    } else if (h >= 90 && h < 170) {
                        greens.r += r; greens.g += g; greens.b += b; greens.count++;
                    } else if (h >= 170 && h < 280) {
                        blues.r += r; blues.g += g; blues.b += b; blues.count++;
                    }
                }
            }
        }

        const getAverageColor = (bucket, fallback) => {
            if (bucket.count === 0) return fallback;
            return `rgb(${Math.round(bucket.r / bucket.count)}, ${Math.round(bucket.g / bucket.count)}, ${Math.round(bucket.b / bucket.count)})`;
        };

        const root = document.documentElement;

        // Apply Structural Colors
        const colorDark = getAverageColor(darks, 'rgb(30, 30, 30)');
        const colorMid = getAverageColor(mids, 'rgb(128, 128, 128)');
        const colorLight = getAverageColor(lights, 'rgb(230, 230, 230)');
        
        root.style.setProperty('--text-white', colorLight);
        root.style.setProperty('--text-main', colorLight);
        root.style.setProperty('--text-header', colorMid);
        root.style.setProperty('text-shadow', `1px 1px 3px ${colorDark}, -1px -1px 3px ${colorDark}, 0px 2px 4px rgba(0,0,0,0.8)`);

        // Apply Dynamic Accent Colors
        root.style.setProperty('--text-red', getAverageColor(reds, 'rgb(224, 108, 117)'));
        root.style.setProperty('--text-yellow', getAverageColor(yellows, 'rgb(229, 192, 123)'));
        root.style.setProperty('--text-green', getAverageColor(greens, 'rgb(74, 246, 38)'));
        root.style.setProperty('--text-blue', getAverageColor(blues, 'rgb(59, 142, 234)'));
        root.style.setProperty('--text-gray', getAverageColor(grays, 'rgb(85, 85, 85)'));

        let maxCount = 0;
        let dominantAccent = 'rgb(74, 246, 38)';

        if (reds.count > maxCount) { maxCount = reds.count; dominantAccent = getAverageColor(reds); }
        if (yellows.count > maxCount) { maxCount = yellows.count; dominantAccent = getAverageColor(yellows); }
        if (greens.count > maxCount) { maxCount = greens.count; dominantAccent = getAverageColor(greens); }
        if (blues.count > maxCount) { maxCount = blues.count; dominantAccent = getAverageColor(blues); }

        // Apply the winning color to the lyrics highlight!
        root.style.setProperty('--text-accent', dominantAccent);
    };

    img.src = base64Image;
}
