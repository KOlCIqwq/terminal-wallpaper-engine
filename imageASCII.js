const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d', {willReadFrequently: true});
const asciiOutput = document.getElementById('asciiOutput');

// A string of characters ordered from darkest to lightest
const density = "Ñ@#W$9876543210?!abc;:+=-,._ ";

let currentAsciiWidth = 80;
let currentFontSize = 8;
let currentThumbnailBase64 = null;

window.myPropertyHandlers = window.myPropertyHandlers || [];

if (!window.wallpaperPropertyListener) {
    window.wallpaperPropertyListener = {
        applyUserProperties: function(properties) {
            window.myPropertyHandlers.forEach(handler => handler(properties));
        }
    };
}

// Push the ASCII slider logic into the shared hub
window.myPropertyHandlers.push(function(properties) {
    let redrawNeeded = false;
    let scaleNeedsUpdate = false;

    if (properties.ascii_resolution) {
        currentAsciiWidth = parseInt(properties.ascii_resolution.value);
        redrawNeeded = true;
        scaleNeedsUpdate = true;
    }

    if (properties.ascii_fontsize) {
        const newSize = parseInt(properties.ascii_fontsize.value);
        asciiOutput.style.fontSize = newSize + 'px';
        asciiOutput.style.lineHeight = (newSize * 0.65) + 'px'; 
        scaleNeedsUpdate = true;
    }

    if (scaleNeedsUpdate){
        const targetPixelWidth = 500;
        const estimatedCharWidth = currentFontSize * 0.6;
        const rawWidth = currentAsciiWidth * estimatedCharWidth;

        const zoomLevel = targetPixelWidth / rawWidth;
        asciiOutput.style.zoom = zoomLevel;
    }

    if (redrawNeeded && currentThumbnailBase64) {
        generateAscii(currentThumbnailBase64);
    }
});

// Listen for Track/Thumbnail Changes
window.wallpaperRegisterMediaThumbnailListener((event) => {
    if (event.thumbnail) {
        currentThumbnailBase64 = event.thumbnail;
        generateAscii(currentThumbnailBase64);
    } else {
        asciiOutput.innerHTML = "";
        currentThumbnailBase64 = null;
    }
});

function generateAscii(base64Image) {
    const asciiImg = new Image();

    asciiImg.onload = () => {
        const asciiWidth = currentAsciiWidth;
        const scaleFactor = asciiWidth / asciiImg.width;
        const asciiHeight = Math.floor(asciiImg.height * scaleFactor);

        canvas.width = asciiWidth;
        canvas.height = asciiHeight;

        ctx.drawImage(asciiImg, 0, 0, asciiWidth, asciiHeight);

        const imageData = ctx.getImageData(0, 0, asciiWidth, asciiHeight);
        const pixels = imageData.data;

        let asciiString = "";

        for (let y = 0; y < asciiHeight; y++) {
            let row = ""; 
            for (let x = 0; x < asciiWidth; x++) {
                const offset = (y * asciiWidth + x) * 4;
                const r = pixels[offset];
                const g = pixels[offset + 1];
                const b = pixels[offset + 2];

                const brightness = (r * 0.299 + g * 0.587 + b * 0.114);
                const charIndex = Math.floor(mapRange(brightness, 0, 255, 0, density.length - 1));

                let char = density.charAt(charIndex);
                if (char === " ") {
                    char = "&nbsp;";
                }
                row += `<span style="color: rgb(${r}, ${g}, ${b});">${char}</span>`;
            }
            asciiString += row + "<br>";
        }
        asciiOutput.innerHTML = asciiString;
    };
    
    asciiImg.src = base64Image;
}

function mapRange(value, inMin, inMax, outMin, outMax) {
    return (value - inMin) * (outMax - outMin) / (inMax - inMin) + outMin;
}