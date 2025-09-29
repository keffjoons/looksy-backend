const { GoogleGenerativeAI } = require('@google/generative-ai');

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

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
  try {
    // Select model based on AI mode
    const modelName = aiMode === 'accurate'
      ? 'gemini-2.0-flash-exp'  // More accurate but slower
      : 'gemini-2.0-flash-exp'; // Fast model

    const model = genAI.getGenerativeModel({ model: modelName });

    // Build the prompt
    const prompt = buildPrompt(productContext, aiMode);

    // Prepare parts for Gemini API
    const parts = [
      { text: prompt },
      userInlinePart,
      ...overlayInlineParts
    ];

    console.log(`🎨 Generating ${aiMode} overlay with ${overlayInlineParts.length} product images`);

    // Generate content
    const result = await model.generateContent({
      contents: [{
        role: 'user',
        parts
      }]
    });

    const response = await result.response;
    const text = response.text();

    // For now, return a placeholder since Gemini text models don't generate images
    // You'll need to implement your own image compositing logic or use a different AI service
    console.log('Gemini response:', text);

    // TODO: Implement actual image generation/compositing
    // This is a placeholder response
    const placeholderImage = generatePlaceholderImage();

    return {
      dataUrl: placeholderImage,
      usage: {
        model: modelName,
        promptTokens: estimateTokens(prompt),
        completionTokens: estimateTokens(text),
        totalTokens: estimateTokens(prompt) + estimateTokens(text)
      }
    };

  } catch (error) {
    console.error('Gemini API error:', error);

    if (error.message?.includes('API key')) {
      throw new Error('Invalid or missing Gemini API key');
    }

    if (error.message?.includes('quota')) {
      throw new Error('API quota exceeded');
    }

    if (error.message?.includes('safety')) {
      throw new Error('Content filtered by safety settings');
    }

    throw new Error(`AI generation failed: ${error.message}`);
  }
}

/**
 * Build prompt for virtual try-on
 */
function buildPrompt(productContext, aiMode) {
  const productTitle = productContext?.title ? `Product: ${productContext.title}\n` : '';
  const hostname = productContext?.hostname ? `From: ${productContext.hostname}\n` : '';

  const basePrompt = `${productTitle}${hostname}

You are an expert virtual try-on assistant. I will provide:
1. A photo of a person
2. One or more product images (clothing, accessories, etc.)

Task: Describe how the product would look when worn by the person in the photo. Consider:
- Fit and sizing relative to the person's body
- Color coordination with their skin tone and existing clothing
- Style compatibility with their appearance
- Realistic placement and positioning

Provide a detailed, helpful description focusing on how well the product would suit this person.`;

  if (aiMode === 'accurate') {
    return basePrompt + `\n\nPlease provide a very detailed analysis including specific styling suggestions and potential fit considerations.`;
  }

  return basePrompt + `\n\nProvide a concise but helpful assessment.`;
}

/**
 * Generate a placeholder image for testing
 * TODO: Replace with actual image generation logic
 */
function generatePlaceholderImage() {
  // This is a 1x1 pixel transparent PNG as base64
  // In production, you'd implement actual image compositing here
  const placeholderBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  return `data:image/png;base64,${placeholderBase64}`;
}

/**
 * Rough token estimation for usage tracking
 */
function estimateTokens(text) {
  if (!text) return 0;
  // Rough estimation: ~4 characters per token
  return Math.ceil(text.length / 4);
}

module.exports = {
  generateOverlayedImage
};