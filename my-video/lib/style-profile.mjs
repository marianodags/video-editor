import { z } from "zod";

// Model output is untrusted: validate the fields consumed by the UI and
// generator before saving a profile or applying an edit.
export const styleProfile = z.object({
  summary: z.string().optional(),
  platform: z.string().optional(),
  aspectRatio: z.enum(["9:16", "16:9", "1:1", "4:5"]).optional(),
  editingPace: z.enum(["slow", "moderate", "fast", "very fast"]).optional(),
  averageShotLengthSeconds: z.number().positive().optional(),
  visualStyle: z.object({
    palette: z.array(z.string()).default([]),
    contrast: z.string().optional(), lighting: z.string().optional()
  }).passthrough().optional(),
  captionStyle: z.object({ enabled: z.boolean().optional() }).passthrough().optional(),
  motion: z.object({ punchIns: z.boolean().optional() }).passthrough().optional(),
  soundDesign: z.object({ music: z.string().optional(), voiceover: z.boolean().optional() }).passthrough().optional(),
  replicationPlan: z.array(z.string()).default([])
}).passthrough();

export function parseStyleProfile(value) {
  const result = styleProfile.safeParse(value);
  if (!result.success) throw Error("Groq returned an invalid style profile. Try analyzing again.");
  return result.data;
}
