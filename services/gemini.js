/**
 * Generate overlayed image using Gemini AI
 * @param {Object} options
 * @param {Object} options.userInlinePart - User image as {inlineData: {mimeType, data}}
 * @param {Array} options.overlayInlineParts - Product images as array of {inlineData: {mimeType, data}}
 * @param {Object} options.productContext - Product metadata
 * @param {string} options.aiMode - 'fast' or 'accurate'
 * @param {string} options.extensionId - Chrome extension ID
 * @returns {Promise<{dataUrl: string, usage?: Object}>}
 */
async function generateOverlayedImage({
  userInlinePart,
  overlayInlineParts,
  productContext,
  aiMode = 'fast',
  extensionId
}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('Missing GEMINI_API_KEY');

  console.log(`🎨 Generating ${aiMode} overlay with ${overlayInlineParts.length} product images`);

  // Build the enhanced prompt for virtual try-on
  const categoryText = productContext?.title ? `Product: ${productContext.title}` : '';
  const sysPrompt = [
    'TASK: Virtual clothing try-on. Replace ALL clothing items worn by the person in the first image with the complete outfit/garment shown in the multiple product reference images.',
    'REQUIREMENTS:',
    '- Use ALL product reference images to understand the garment from different angles, lighting, and details',
    '- Replace the entire outfit - ALL clothing pieces visible on the person, not just one item',
    '- Combine information from multiple product views for the most accurate color, pattern, texture, and fit',
    '- Accurately fit the new garment to the person\'s body shape and posture',
    '- Maintain realistic fabric draping, shadows, and lighting that matches the original scene',
    '- Preserve the person\'s pose, facial features, skin tone, and body proportions exactly',
    '- Keep the background completely unchanged',
    '- If aspect ratios don\'t match output size, crop to focus on the person rather than squishing or distorting the image',
    '- Ensure the garment details match what is shown across all product reference images',
    '- Make the transformation look natural and professionally fitted',
    categoryText,
    'OUTPUT: Generate a high-resolution 2K (2048px minimum) image. Return only the modified image as data:image/png;base64,<BASE64> format. Make clear visual changes with maximum detail and quality.'
  ].filter(Boolean).join(' ');

  // Use the image generation model (not text model)
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash-image-preview';
  console.log(`🤖 Using model: ${model}`);

  // Build parts for Gemini API - prompt text first, then images
  const parts = [
    { text: sysPrompt },
    userInlinePart,
    ...overlayInlineParts
  ];

  // Make API request with retry logic
  let lastError;
  const maxRetries = 3;
  const baseDelay = 1000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const body = {
        contents: [{ role: 'user', parts }],
        generationConfig: { temperature: 0 }
      };

      if (attempt > 1) {
        const delay = baseDelay * Math.pow(2, attempt - 1);
        console.log(`⏳ Attempt ${attempt}/${maxRetries} after ${delay}ms delay`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      }, 30000); // 30 second timeout

      const responseText = await response.text();

      if (!response.ok) {
        const isRetryableError = response.status === 500 || response.status === 502 || response.status === 503;
        console.error(`❌ Gemini API error (attempt ${attempt}/${maxRetries}): ${response.status} ${responseText}`);

        if (isRetryableError && attempt < maxRetries) {
          lastError = new Error(`Gemini API error: ${response.status} ${responseText}`);
          continue;
        }

        throw new Error(`Gemini API error: ${response.status} ${responseText}`);
      }

      // Success! Parse response
      console.log(`✅ Gemini API succeeded on attempt ${attempt}/${maxRetries}`);
      const json = safeJson(responseText);
      const partsResp = json?.candidates?.[0]?.content?.parts || [];
      const finish = json?.candidates?.[0]?.finishReason || '';
      const blockReason = json?.promptFeedback?.blockReason || '';

      console.log(`📊 Response: finish=${finish}, block=${blockReason}, parts=${partsResp.length}`);

      // Extract image data from response
      for (const part of partsResp) {
        // Support both snake_case and camelCase
        const inline = part?.inline_data || part?.inlineData;
        const data = inline?.data;
        const mimeType = inline?.mime_type || inline?.mimeType;

        if (data && (mimeType ? String(mimeType).includes('image/') : true)) {
          return {
            dataUrl: `data:image/png;base64,${data}`,
            usage: {
              model,
              promptTokens: estimateTokens(sysPrompt),
              totalTokens: estimateTokens(sysPrompt)
            }
          };
        }
      }

      // Check for text-embedded base64 images
      for (const part of partsResp) {
        const text = part?.text;
        if (!text) continue;

        const idx = text.indexOf('data:image/png;base64,');
        if (idx !== -1) {
          const candidate = text.slice(idx).trim();
          const clean = candidate.replace(/[`'"\)\]]+$/, '');
          return {
            dataUrl: clean,
            usage: {
              model,
              promptTokens: estimateTokens(sysPrompt),
              totalTokens: estimateTokens(sysPrompt)
            }
          };
        }
      }

      // If we get here, no image was found in response
      const block = json?.promptFeedback?.blockReason || '';
      throw new Error(block ? `Gemini API returned no image data (blockReason: ${block})` : 'Gemini API returned no image data');

    } catch (error) {
      lastError = error;
      if (attempt === maxRetries) {
        console.error(`❌ All ${maxRetries} attempts failed, last error:`, error.message);
        throw error;
      }
      console.warn(`⚠️  Attempt ${attempt}/${maxRetries} failed:`, error.message);
    }
  }

  throw lastError || new Error('Failed to get response from Gemini API');
}

/**
 * Safe JSON parsing
 */
function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

/**
 * Fetch with timeout
 */
async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}

/**
 * Rough token estimation for usage tracking
 */
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

module.exports = {
  generateOverlayedImage
};