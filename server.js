const express = require('express');
const cors = require('cors');
const { generateOverlayedImage } = require('./services/gemini');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// CORS configuration for Chrome extensions
app.use(cors({
  origin: (origin, callback) => {
    // Allow Chrome extensions and localhost for development
    if (!origin ||
        origin.startsWith('chrome-extension://') ||
        origin.startsWith('moz-extension://') ||
        origin.includes('localhost')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

// Parse JSON with larger limit for base64 images
app.use(express.json({ limit: '10mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'looksy-backend'
  });
});

// Validate extension ID middleware
function validateExtension(req, res, next) {
  const allowedIds = process.env.CHROME_EXTENSION_IDS?.split(',') || [];
  const extensionId = req.body?.extensionId || req.headers['x-mm-extension-id'];

  if (!allowedIds.includes(extensionId)) {
    return res.status(403).json({
      error: 'Extension not authorized',
      code: 'INVALID_EXTENSION_ID'
    });
  }

  req.extensionId = extensionId;
  next();
}

// Data URI validation helpers
const ALLOWED_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/avif']);
const MAX_DATAURI_BYTES = 8 * 1024 * 1024; // 8MB per image

function parseDataUri(dataUri) {
  if (!dataUri || typeof dataUri !== 'string') {
    throw new Error('Invalid data URI format');
  }

  const match = dataUri.match(/^data:([^;]+);base64,(.*)$/);
  if (!match) {
    throw new Error('Invalid data URI format');
  }

  const mimeType = match[1].toLowerCase();
  const base64Data = match[2];

  if (!ALLOWED_MIME.has(mimeType)) {
    throw new Error(`Unsupported mime type: ${mimeType}`);
  }

  // Estimate size from base64 length
  const approxBytes = Math.floor((base64Data.length * 3) / 4);
  if (approxBytes > MAX_DATAURI_BYTES) {
    throw new Error('Image too large');
  }

  return { mimeType, base64: base64Data };
}

// Main try-on endpoint
app.post('/api/extension/tryon', validateExtension, async (req, res) => {
  try {
    const {
      userImage,
      overlayData,
      overlayUrls,
      productContext,
      planType = 'standard'
    } = req.body;

    // Validate user image
    if (!userImage?.startsWith('data:')) {
      return res.status(400).json({
        error: 'userImage must be a data URI',
        code: 'INVALID_USER_IMAGE'
      });
    }

    // Parse user image
    const userParsed = parseDataUri(userImage);
    const userInlinePart = {
      inlineData: {
        mimeType: userParsed.mimeType,
        data: userParsed.base64
      }
    };

    // Parse overlay images (prefer overlayData over overlayUrls)
    let overlayInlineParts = [];

    if (Array.isArray(overlayData) && overlayData.length) {
      // Use base64 data URIs (preferred)
      overlayInlineParts = overlayData
        .slice(0, 3) // Limit to 3 images
        .map(dataUri => {
          const parsed = parseDataUri(dataUri);
          return {
            inlineData: {
              mimeType: parsed.mimeType,
              data: parsed.base64
            }
          };
        });
    } else if (Array.isArray(overlayUrls) && overlayUrls.length) {
      // Fallback: fetch URLs and convert to base64
      const urls = overlayUrls.slice(0, 3);
      const fetchPromises = urls.map(async (url) => {
        try {
          const response = await fetch(url, {
            headers: { 'User-Agent': 'LooksyAI/1.0' },
            timeout: 10000
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const buffer = Buffer.from(await response.arrayBuffer());
          const mimeType = (response.headers.get('content-type') || 'image/jpeg').split(';')[0];

          if (!ALLOWED_MIME.has(mimeType)) {
            throw new Error(`Unsupported mime: ${mimeType}`);
          }

          return {
            inlineData: {
              mimeType,
              data: buffer.toString('base64')
            }
          };
        } catch (error) {
          console.warn('Failed to fetch overlay image:', url, error.message);
          return null;
        }
      });

      const results = await Promise.all(fetchPromises);
      overlayInlineParts = results.filter(Boolean);
    }

    if (!overlayInlineParts.length) {
      return res.status(422).json({
        error: 'No valid overlay images provided',
        code: 'NO_OVERLAY_IMAGES'
      });
    }

    // Determine AI mode based on plan
    const aiMode = planType === 'unlimited' ? 'accurate' : 'fast';

    // Generate the overlayed image
    const result = await generateOverlayedImage({
      userInlinePart,
      overlayInlineParts,
      productContext,
      aiMode,
      extensionId: req.extensionId
    });

    res.json({
      ok: true,
      result: result.dataUrl,
      usage: result.usage || {}
    });

  } catch (error) {
    console.error('Try-on error:', error);

    // Return appropriate error codes
    if (error.message.includes('Image too large')) {
      return res.status(413).json({ error: error.message, code: 'IMAGE_TOO_LARGE' });
    }

    if (error.message.includes('Unsupported mime') || error.message.includes('Invalid data URI')) {
      return res.status(400).json({ error: error.message, code: 'INVALID_IMAGE_FORMAT' });
    }

    res.status(500).json({
      error: 'Internal server error',
      code: 'GENERATION_FAILED',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    error: 'Internal server error',
    code: 'UNHANDLED_ERROR'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    code: 'NOT_FOUND'
  });
});

app.listen(PORT, () => {
  console.log(`🚀 LooksyAI Backend running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🎨 Try-on endpoint: http://localhost:${PORT}/api/extension/tryon`);
});