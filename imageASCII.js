const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d', {willReadFrequently: true});

const asciiOutput = document.getElementById('asciiOutput');
const asciiCtx = asciiOutput.getContext('2d');

const density = "Ñ@#W$9876543210?!abc;:+=-,._ ";
const densityLen = density.length - 1;

let currentImageSize = 500;
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
window.myPropertyHandlers = window.myPropertyHandlers || [];

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
        // Clear the canvas if there is no image
        asciiCtx.clearRect(0, 0, asciiOutput.width, asciiOutput.height);
        currentThumbnailBase64 = null;
    }
});

function generateAscii(base64Image) {
    const asciiImg = new Image();

    asciiImg.onload = () => {
        // Calculate the character dimensions first
        const charWidth = currentFontSize * 0.6;
        const charHeight = currentFontSize * 0.65; 
        
        // How many characters fit in the requested physical size
        const asciiWidth = Math.floor(currentImageSize / charWidth);
        const scaleFactor = asciiWidth / asciiImg.width;
        const asciiHeight = Math.floor(asciiImg.height * scaleFactor);

        // Draw image to hidden canvas to sample the raw pixels
        canvas.width = asciiWidth;
        canvas.height = asciiHeight;
        ctx.drawImage(asciiImg, 0, 0, asciiWidth, asciiHeight);

        const imageData = ctx.getImageData(0, 0, asciiWidth, asciiHeight);
        const pixels = imageData.data;
        
        // Set the output canvas to the exact 1:1 pixel size requested
        asciiOutput.width = asciiWidth * charWidth;
        asciiOutput.height = asciiHeight * charHeight;
        
        asciiCtx.clearRect(0, 0, asciiOutput.width, asciiOutput.height);
        asciiCtx.font = `bold ${currentFontSize}px Consolas, "Courier New", monospace`;
        asciiCtx.textBaseline = "top";

        for (let y = 0; y < asciiHeight; y++) {
            for (let x = 0; x < asciiWidth; x++) {
                const offset = (y * asciiWidth + x) * 4;
                const r = pixels[offset];
                const g = pixels[offset + 1];
                const b = pixels[offset + 2];

                // integer math for brightness
                const brightness = (r * 299 + g * 587 + b * 114) / 1000;
                const charIndex = Math.floor((brightness / 255) * densityLen);
                
                const char = density[charIndex];

                // Skip drawing empty space
                if (char !== " ") {
                    asciiCtx.fillStyle = `rgb(${r}, ${g}, ${b})`;
                    asciiCtx.fillText(char, x * charWidth, y * charHeight);
                }
            }
        }
    };
    
    asciiImg.src = base64Image;
}