const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs').promises;
const { generateOverlayedImage, generateStudioImage } = require('./services/gemini');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Set up multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error('Only JPEG, PNG, and WebP images are allowed'));
  }
});

// Create uploads directory for storing studio images
const uploadsDir = path.join(__dirname, 'uploads');
fs.mkdir(uploadsDir, { recursive: true }).catch(console.error);

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

// Parse JSON with larger limit for compressed base64 images
app.use(express.json({ limit: '15mb' }));

// Add request size logging middleware
app.use((req, res, next) => {
  if (req.path === '/api/extension/tryon') {
    const payloadSize = Buffer.byteLength(JSON.stringify(req.body));
    console.log(`📦 Tryon request: ${Math.round(payloadSize / 1024)}KB`);
  }
  next();
});

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
const MAX_REQUEST_SIZE = 25 * 1024 * 1024; // 25MB total request size

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

// Studio image generation endpoint
app.post('/api/studio/generate', upload.single('image'), async (req, res) => {
  try {
    console.log('🎨 Studio image generation requested');

    if (!req.file) {
      return res.status(400).json({
        error: 'No image provided',
        code: 'NO_IMAGE'
      });
    }

    const { consent, target_pose = 'neutral', background = 'neutral' } = req.body;

    if (consent !== 'true') {
      return res.status(400).json({
        error: 'User consent required',
        code: 'CONSENT_REQUIRED'
      });
    }

    // Generate unique ID for this studio image
    const studioId = `studio_${uuidv4()}`;
    const filename = `${studioId}.jpg`;
    const filepath = path.join(uploadsDir, filename);

    // Transform with Gemini AI
    const userInlinePart = {
      inlineData: {
        mimeType: req.file.mimetype,
        data: req.file.buffer.toString('base64')
      }
    };

    console.log(`🎨 Transforming to studio image: pose=${target_pose}, bg=${background}`);
    const result = await generateStudioImage({
      userInlinePart,
      targetPose: target_pose,
      background: background
    });

    // Save the transformed image
    const base64Data = result.dataUrl.replace(/^data:image\/\w+;base64,/, '');
    await fs.writeFile(filepath, Buffer.from(base64Data, 'base64'));
    console.log(`✅ Studio image saved: ${filename}`);

    // Return success response
    const cdnUrl = `${req.protocol}://${req.get('host')}/uploads/${filename}`;

    res.json({
      studio_id: studioId,
      cdn_url: cdnUrl,
      pose_id: target_pose,
      created_at: Date.now(),
      ttl: 86400 // 24 hours
    });

  } catch (error) {
    console.error('Studio generation error:', error);
    res.status(500).json({
      error: 'Failed to generate studio image',
      code: 'GENERATION_FAILED'
    });
  }
});

// Auth refresh endpoint (simplified for MVP)
app.post('/api/auth/refresh', (req, res) => {
  // Simple token generation for testing
  res.json({
    token: 'test-jwt-token-' + Date.now(),
    expires_in: 86400,
    refresh_token: 'refresh-' + uuidv4()
  });
});

// GDPR data deletion endpoint
app.delete('/api/user/delete-data', async (req, res) => {
  // In production, delete user's data from database
  console.log('🗑️ User data deletion requested');
  res.json({ success: true, message: 'User data deleted' });
});

// Main try-on endpoint (with studio mode support)
app.post('/api/extension/tryon', validateExtension, async (req, res) => {
  try {
    // Quick request size check
    const requestSizeEstimate = JSON.stringify(req.body).length;
    if (requestSizeEstimate > MAX_REQUEST_SIZE) {
      return res.status(413).json({
        error: 'Request too large',
        code: 'REQUEST_TOO_LARGE'
      });
    }

    const {
      studioId,
      userImage,
      overlayData,
      overlayUrls,
      productContext,
      useStudioMode,
      planType = 'standard'
    } = req.body;

    // Handle studio mode
    let actualUserImage = userImage;
    if (useStudioMode && studioId) {
      // Use studio image instead of direct user image
      const studioPath = path.join(uploadsDir, `${studioId}.jpg`);
      try {
        const studioBuffer = await fs.readFile(studioPath);
        actualUserImage = `data:image/jpeg;base64,${studioBuffer.toString('base64')}`;
        console.log('🎨 Using studio image:', studioId);
      } catch (error) {
        console.warn('Studio image not found, falling back to regular mode:', studioId);
      }
    }

    // Validate user image
    if (!actualUserImage?.startsWith('data:')) {
      return res.status(400).json({
        error: 'userImage must be a data URI',
        code: 'INVALID_USER_IMAGE'
      });
    }

    // Parse user image
    const userParsed = parseDataUri(actualUserImage);
    const userInlinePart = {
      inlineData: {
        mimeType: userParsed.mimeType,
        data: userParsed.base64
      }
    };

    // Parse overlay images (prefer overlayData over overlayUrls)
    let overlayInlineParts = [];

    if (Array.isArray(overlayData) && overlayData.length) {
      // Use base64 data URIs (preferred path)
      console.log(`🖼️ Using ${overlayData.length} compressed overlay images from overlayData`);
      overlayInlineParts = overlayData
        .slice(0, 3) // Limit to 3 images
        .map(dataUri => {
          try {
            const parsed = parseDataUri(dataUri);
            console.log(`📐 Overlay image: ${parsed.mimeType}, ~${Math.round(parsed.base64.length * 0.75 / 1024)}KB`);
            return {
              inlineData: {
                mimeType: parsed.mimeType,
                data: parsed.base64
              }
            };
          } catch (error) {
            console.warn('Failed to parse overlay data URI:', error.message);
            return null;
          }
        })
        .filter(Boolean);
    } else if (Array.isArray(overlayUrls) && overlayUrls.length) {
      // Fallback: fetch URLs and convert to base64 (less preferred)
      console.log(`🌐 Fallback: Fetching ${overlayUrls.length} overlay images from URLs`);
      const urls = overlayUrls.slice(0, 3);
      const fetchPromises = urls.map(async (url) => {
        try {
          const response = await fetch(url, {
            headers: { 'User-Agent': 'LooksyAI/1.0' },
            timeout: 15000 // Increased timeout
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const buffer = Buffer.from(await response.arrayBuffer());
          const mimeType = (response.headers.get('content-type') || 'image/jpeg').split(';')[0];

          if (!ALLOWED_MIME.has(mimeType)) {
            throw new Error(`Unsupported mime: ${mimeType}`);
          }

          console.log(`📐 Fetched overlay: ${mimeType}, ${Math.round(buffer.length / 1024)}KB`);
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

    // Return appropriate error codes with user-friendly messages
    if (error.message.includes('Image too large')) {
      return res.status(413).json({
        error: 'Image too large. Please try a smaller image.',
        code: 'IMAGE_TOO_LARGE'
      });
    }

    if (error.message.includes('Unsupported mime') || error.message.includes('Invalid data URI')) {
      return res.status(422).json({
        error: 'Invalid image format. Please use JPG, PNG, or WebP images.',
        code: 'INVALID_IMAGE_FORMAT'
      });
    }

    if (error.message.includes('Missing GEMINI_API_KEY')) {
      console.error('🚨 GEMINI_API_KEY not configured!');
      return res.status(500).json({
        error: 'AI service not configured. Please contact support.',
        code: 'SERVICE_UNAVAILABLE'
      });
    }

    if (error.message.includes('quota') || error.message.includes('rate limit')) {
      return res.status(429).json({
        error: 'Service temporarily at capacity. Please try again in a moment.',
        code: 'RATE_LIMITED'
      });
    }

    res.status(500).json({
      error: 'AI generation temporarily unavailable. Please try again.',
      code: 'GENERATION_FAILED',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Serve uploaded studio images
app.use('/uploads', express.static(uploadsDir));

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