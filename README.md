# LooksyAI Backend

Backend API server for the LooksyAI Chrome Extension that provides AI-powered virtual try-on functionality.

## Features

- 🎨 Virtual try-on API endpoint
- 🛡️ Chrome extension authentication
- 📷 Base64 image processing
- 🤖 Gemini AI integration
- ⚡ CORS-enabled for browser extensions
- 📊 Health check endpoint

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Environment Setup

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` and add your configuration:

```env
GEMINI_API_KEY=your_gemini_api_key_here
CHROME_EXTENSION_IDS=gphnamdjcdhpmfeongphlidjlahkjafk
NODE_ENV=development
```

### 3. Run Development Server

```bash
npm run dev
```

Server will start at `http://localhost:3000`

## API Endpoints

### Health Check

```
GET /health
```

Returns server status and timestamp.

### Virtual Try-On

```
POST /api/extension/tryon
```

**Headers:**
- `Content-Type: application/json`
- `x-mm-extension-id: {extension_id}` (optional, can be in body)

**Request Body:**
```json
{
  "extensionId": "gphnamdjcdhpmfeongphlidjlahkjafk",
  "userImage": "data:image/jpeg;base64,...",
  "overlayData": ["data:image/jpeg;base64,..."],
  "productContext": {
    "title": "Product Name",
    "hostname": "example.com"
  },
  "planType": "standard"
}
```

**Response:**
```json
{
  "ok": true,
  "result": "data:image/jpeg;base64,...",
  "usage": {
    "model": "gemini-2.0-flash-exp",
    "promptTokens": 150,
    "completionTokens": 50,
    "totalTokens": 200
  }
}
```

## Deployment on Render

### 1. Create Web Service

- **Repository:** Point to this repository
- **Build Command:** `npm install && npm run build`
- **Start Command:** `npm run start`
- **Environment:** Node

### 2. Environment Variables

Add these in Render dashboard:

```
GEMINI_API_KEY=your_actual_api_key
CHROME_EXTENSION_IDS=gphnamdjcdhpmfeongphlidjlahkjafk
NODE_ENV=production
```

### 3. Health Check

Set health check path to `/health` in Render settings.

## Chrome Extension Integration

The backend expects requests from the Chrome extension with:

1. **Authentication:** Extension ID validation
2. **Image Format:** Base64 data URIs in `overlayData` field
3. **CORS:** Configured for `chrome-extension://` origins
4. **Response Format:** Returns data URI for overlayed image

## Development

### Project Structure

```
looksy-backend/
├── server.js           # Main Express server
├── services/
│   └── gemini.js      # Gemini AI integration
├── package.json       # Dependencies
├── .env.example       # Environment variables template
└── README.md          # This file
```

### Adding Features

1. **New Endpoints:** Add routes in `server.js`
2. **AI Models:** Modify `services/gemini.js`
3. **Validation:** Update middleware in `server.js`

### Error Handling

The API returns structured errors:

```json
{
  "error": "Description of the error",
  "code": "ERROR_CODE"
}
```

Common error codes:
- `INVALID_EXTENSION_ID`: Extension not authorized
- `INVALID_USER_IMAGE`: User image format invalid
- `NO_OVERLAY_IMAGES`: No valid product images
- `IMAGE_TOO_LARGE`: Image exceeds size limit
- `GENERATION_FAILED`: AI processing failed

## License

ISC