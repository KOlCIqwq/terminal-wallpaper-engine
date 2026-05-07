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
        extractAndApplyColors(currentThumbnailBase64);
    } else {
        // Clear the canvas if there is no image
        asciiCtx.clearRect(0, 0, asciiOutput.width, asciiOutput.height);
        currentThumbnailBase64 = null;
    }
});

// expose the function to reapply the colors
window.reapplyDynamicColors = function() {
    if (currentThumbnailBase64) {
        extractAndApplyColors(currentThumbnailBase64);
    }
};

window.wallpaperRegisterMediaThumbnailListener((event) => {
    if (event.thumbnail) {
        currentThumbnailBase64 = event.thumbnail;
        generateAscii(currentThumbnailBase64);
        
        // Only extract colors if the user wants Dynamic Colors
        if (!window.useCustomColors) {
            extractAndApplyColors(currentThumbnailBase64);
        }
        
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

function extractAndApplyColors(base64Image) {
    const img = new Image();

    img.onload = () => {
        // Create a tiny off-screen canvas to sample colors quickly
        const sampleCanvas = document.createElement('canvas');
        const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });
        
        // 64x64 is plenty to get a good average without lagging the UI
        sampleCanvas.width = 64;
        sampleCanvas.height = 64;
        sampleCtx.drawImage(img, 0, 0, 64, 64);

        const imageData = sampleCtx.getImageData(0, 0, 64, 64);
        const data = imageData.data;

        let darks = { r: 0, g: 0, b: 0, count: 0 };
        let mids = { r: 0, g: 0, b: 0, count: 0 };
        let lights = { r: 0, g: 0, b: 0, count: 0 };

        // Loop through pixels
        for (let i = 0; i < data.length; i += 4) {
            let r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
            
            // Skip transparent pixels
            if (a < 128) continue; 
            
            // Calculate perceived luminance (0 to 255)
            let luminance = (0.299 * r + 0.587 * g + 0.114 * b);

            // Group pixels into buckets based on brightness
            if (luminance < 85) {
                darks.r += r; darks.g += g; darks.b += b; darks.count++;
            } else if (luminance < 170) {
                mids.r += r; mids.g += g; mids.b += b; mids.count++;
            } else {
                lights.r += r; lights.g += g; lights.b += b; lights.count++;
            }
        }

        // Helper to get the average rgb string from a bucket, with a fallback
        const getAverageColor = (bucket, fallback) => {
            if (bucket.count === 0) return fallback;
            return `rgb(${Math.round(bucket.r / bucket.count)}, ${Math.round(bucket.g / bucket.count)}, ${Math.round(bucket.b / bucket.count)})`;
        };

        const colorDark = getAverageColor(darks, 'rgb(30, 30, 30)');
        const colorMid = getAverageColor(mids, 'rgb(128, 128, 128)');
        // Boost the light color slightly to guarantee readability
        const colorLight = getAverageColor(lights, 'rgb(230, 230, 230)');

        const root = document.documentElement;

        root.style.setProperty('--text-white', colorLight);
        root.style.setProperty('--text-main', colorLight);
        root.style.setProperty('--text-header', colorMid);
        
        root.style.setProperty('text-shadow', `1px 1px 3px ${colorDark}, -1px -1px 3px ${colorDark}, 0px 2px 4px rgba(0,0,0,0.8)`);
    };

    img.src = base64Image;
}