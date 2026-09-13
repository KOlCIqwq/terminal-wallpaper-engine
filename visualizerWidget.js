// --- Visualizer & Mood Widget Logic ---
const waveChars = [' ', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
const waveHistory = {
    sub: new Array(30).fill(0),
    bass: new Array(30).fill(0),
    lomid: new Array(30).fill(0),
    mid: new Array(30).fill(0),
    himid: new Array(30).fill(0),
    pres: new Array(30).fill(0),
    treb: new Array(30).fill(0),
    volume: new Array(30).fill(0)
};

const globalPeakHistory = [];

const moodHistory = {
    sub: [],
    bass: [],
    lomid: [],
    mid: [],
    himid: [],
    pres: [],
    treb: []
};

let currentDisplayedMood = "( - _ - )";
let targetMood = "( - _ - )";
let moodConfidence = 0;
const CONFIDENCE_THRESHOLD = 12;

function getPeak(array, start, end) {
    let peak = 0;
    for (let i = start; i <= end; i++) {
        if (array[i] > peak) peak = array[i];
    }
    return peak;
}

function getAverage(array, start, end) {
    let sum = 0;
    for (let i = start; i <= end; i++) {
        sum += array[i];
    }
    return sum / (end - start + 1);
}
window.getAverage = getAverage;

function updatePercent(elementId, val) {
    let percentage = Math.round(val * 100);
    if (percentage > 100) percentage = 100;
    const el = document.getElementById(elementId);
    if (el) el.textContent = percentage + '%';
}

function updateWaveBar(elementId, historyArray, value) {
    const totalLength = 30;
    historyArray.push(value);
    if (historyArray.length > totalLength) {
        historyArray.shift();
    }
    
    let barHTML = "";
    for (let i = 0; i < totalLength; i++) {
        let val = historyArray[i];
        let clampedValue = Math.max(0, Math.min(val, 1));
        
        let charIndex = Math.floor(clampedValue * (waveChars.length - 1));
        let char = waveChars[charIndex];
        
        let colorClass = "green";
        if (clampedValue >= 0.6 && clampedValue < 0.85) {
            colorClass = "yellow";
        } else if (clampedValue >= 0.85) {
            colorClass = "red";
        }
        
        if (clampedValue > 0.05) {
            barHTML += `<span class="${colorClass} glow">${char}</span>`;
        } else {
            barHTML += '<span class="gray">·</span>';
        }
    }
    
    const el = document.getElementById(elementId);
    if (el) el.innerHTML = barHTML;
}

function updateBar(elementId, value) {
    const totalLength = 30; 
    const clampedValue = Math.max(0, Math.min(value, 1));
    const filledCount = Math.floor(clampedValue * totalLength);
    const charFilled = window.charFilled || '|';
    const charEmpty = window.charEmpty || '·';

    let barHTML = "";
    for (let i = 0; i < totalLength; i++) {
        let colorClass = "green";
        if (i >= 18 && i < 25) {
            colorClass = "yellow";
        } else if (i >= 25) {
            colorClass = "red";
        }

        if (i < filledCount) {
            barHTML += `<span class="${colorClass} glow">${charFilled}</span>`;
        } else {
            barHTML += `<span class="gray">${charEmpty}</span>`;
        }
    }
    
    const el = document.getElementById(elementId);
    if (el) el.innerHTML = barHTML;
}

function updateMusicMood(sub, bass, lomid, mid, himid, pres, treb, volume) {
    const moodFaceEl = document.getElementById('mood-face');
    if (!moodFaceEl) return;

    moodHistory.sub.push(sub);
    moodHistory.bass.push(bass);
    moodHistory.lomid.push(lomid);
    moodHistory.mid.push(mid);
    moodHistory.himid.push(himid);
    moodHistory.pres.push(pres);
    moodHistory.treb.push(treb);

    if (moodHistory.sub.length > 40) {
        for (let key in moodHistory) moodHistory[key].shift();
    }

    const getAvg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
    
    const s = getAvg(moodHistory.sub);
    const b = getAvg(moodHistory.bass);
    const lm = getAvg(moodHistory.lomid);
    const m = getAvg(moodHistory.mid);
    const hm = getAvg(moodHistory.himid);
    const p = getAvg(moodHistory.pres);
    const t = getAvg(moodHistory.treb);

    const lowZone = (s + b) / 2;
    const midZone = (lm + m + hm) / 3;
    const highZone = (p + t) / 2;

    const totalEnergy = (lowZone + midZone + highZone) / 3;

    let calculatedMood = "( - _ - )";
    
    if (totalEnergy < 0.05) {
        calculatedMood = "_(:3 」∠ )_";
    } else if (totalEnergy > 0.65) {
        calculatedMood = "٩(•ิ˓̭ •ิ )ง";
    } else {
        if (lowZone > midZone + 0.1 && highZone > midZone + 0.1) {
            calculatedMood = "( ☆▽☆ )";
        } else if (lowZone > midZone + 0.1 && lowZone > highZone + 0.1) {
            calculatedMood = "( ⌐■_■ )";
        } else if (midZone > lowZone + 0.1 && midZone > highZone + 0.1) {
            calculatedMood = "( • ̀ω•́ )";
        } else if (lowZone > highZone + 0.1 && midZone > highZone + 0.1) {
            calculatedMood = "ƪ(•̃͡ε•̃͡)∫";
        } else {
            calculatedMood = "d(`･∀･)b";
        }
    }

    if (calculatedMood === targetMood) {
        moodConfidence++;
    } else {
        targetMood = calculatedMood;
        moodConfidence = 0;
    }

    if (moodConfidence >= CONFIDENCE_THRESHOLD && currentDisplayedMood !== targetMood) {
        currentDisplayedMood = targetMood;
        moodFaceEl.textContent = currentDisplayedMood;
        moodConfidence = Math.floor(CONFIDENCE_THRESHOLD / 2);
    }
}

if (window.wallpaperRegisterAudioListener) {
    window.wallpaperRegisterAudioListener((audioArray) => {
        let currentMax = 0;
        let totalSum = 0;

        for (let i = 0; i < 128; i++) {
            let val = audioArray[i];
            totalSum += val;
            if (val > currentMax) currentMax = val;
        }

        globalPeakHistory.push(currentMax);
        if (globalPeakHistory.length > 30) globalPeakHistory.shift();
        
        let smoothedPeak = Math.max(...globalPeakHistory);
        let dynamicNormalizer = 1.0 / Math.max(0.01, smoothedPeak);

        let sub = getPeak(audioArray, 0, 2) * dynamicNormalizer;
        let bass = getPeak(audioArray, 3, 5) * dynamicNormalizer;
        let lomid = getPeak(audioArray, 6, 12) * dynamicNormalizer;
        let mid = getPeak(audioArray, 13, 22) * dynamicNormalizer;
        let himid = getPeak(audioArray, 23, 35) * dynamicNormalizer;
        let pres = getPeak(audioArray, 36, 49) * dynamicNormalizer;
        let treb = getPeak(audioArray, 50, 63) * dynamicNormalizer;
        
        let volume = (totalSum / 128) * dynamicNormalizer;

        updatePercent('sub-perc', sub);
        updatePercent('bass-perc', bass);
        updatePercent('lomid-perc', lomid);
        updatePercent('mid-perc', mid);
        updatePercent('himid-perc', himid);
        updatePercent('pres-perc', pres);
        updatePercent('treb-perc', treb);
        updatePercent('volume-perc', volume * 2);

        updateWaveBar('bar-sub', waveHistory.sub, sub);
        updateWaveBar('bar-bass', waveHistory.bass, bass);
        updateWaveBar('bar-lomid', waveHistory.lomid, lomid);
        updateWaveBar('bar-mid', waveHistory.mid, mid);
        updateWaveBar('bar-himid', waveHistory.himid, himid);
        updateWaveBar('bar-pres', waveHistory.pres, pres);
        updateWaveBar('bar-treb', waveHistory.treb, treb);
        updateWaveBar('bar-volume', waveHistory.volume, volume * 2);
        
        updateMusicMood(sub, bass, lomid, mid, himid, pres, treb, volume * 2);
    });
}

