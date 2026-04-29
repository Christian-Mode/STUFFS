import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export interface TrendHunterResult {
  trends: Array<{
    topic: string;
    growth: number;
    source: string;
    keywords: string[];
    audience: string;
  }>;
}

export async function huntTrends(): Promise<TrendHunterResult> {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: "Scan global digital platforms and identify 3 rising viral trends for short-form video content (TikTok, Reels, Shorts). Provide specific niche, growth percentage (simulated), source, and keywords.",
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          trends: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                topic: { type: Type.STRING },
                growth: { type: Type.NUMBER },
                source: { type: Type.STRING },
                keywords: { type: Type.ARRAY, items: { type: Type.STRING } },
                audience: { type: Type.STRING }
              },
              required: ["topic", "growth", "source", "keywords", "audience"]
            }
          }
        },
        required: ["trends"]
      }
    }
  });

  return JSON.parse(response.text);
}

export async function generateConcept(trend: any) {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Based on this trend: "${trend.topic}", generate a viral video concept for a short-form video. Trending audience is ${trend.audience}.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          angle: { type: Type.STRING },
          targetAudience: { type: Type.STRING }
        },
        required: ["title", "angle", "targetAudience"]
      }
    }
  });
  return JSON.parse(response.text);
}

export async function writeScript(concept: any) {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Write a retention-optimized script for this video concept: "${concept.title}". Angle: ${concept.angle}. 
    Structure: Hook (0-2s), Curiosity Gap, Value Delivery, Pattern Interrupt, CTA.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          hook: { type: Type.STRING },
          body: { type: Type.STRING },
          cta: { type: Type.STRING },
          visualCues: { type: Type.STRING },
          durationEstimate: { type: Type.NUMBER }
        },
        required: ["hook", "body", "cta", "visualCues", "durationEstimate"]
      }
    }
  });
  return JSON.parse(response.text);
}

export async function generatePostAssets(script: any) {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Generate social media metadata (caption and hashtags) for a video with this script: "${script.hook} ... ${script.body}".`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          caption: { type: Type.STRING },
          hashtags: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ["caption", "hashtags"]
      }
    }
  });
  return JSON.parse(response.text);
}

export async function analyzePerformance(post: any) {
  // Simulating analytics based on content quality
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Simulate potential performance analytics for this post: "${post.caption}". Provide views, likes, and shares estimates.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          views: { type: Type.NUMBER },
          likes: { type: Type.NUMBER },
          shares: { type: Type.NUMBER }
        },
        required: ["views", "likes", "shares"]
      }
    }
  });
  return JSON.parse(response.text);
}
