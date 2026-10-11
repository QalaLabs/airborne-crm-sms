import { type NextRequest } from "next/server";
import { z } from "zod";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";
import { ForbiddenError, RateLimitError } from "@/lib/utils/errors";
import { consumeRateLimit } from "@/lib/utils/rate-limit";

const askSchema = z.object({
  question: z.string().min(1).max(4000),
  topicId: z.string().uuid().optional(),
  courseTitle: z.string().optional(),
  chapterTitle: z.string().optional(),
  topicTitle: z.string().optional(),
  contextText: z.string().max(20000).optional(),
});

/**
 * Contextual Gemini QA for students.
 * Requires GEMINI_API_KEY. Returns a safe stub when key missing (no crash / no prod break).
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "lms");

    if (ctx.user.role !== "STUDENT" && ctx.user.role !== "TEACHER" && ctx.user.role !== "ADMIN" && ctx.user.role !== "SUPER_ADMIN") {
      throw new ForbiddenError("read", "lms");
    }

    // External LLM spend protection: 10 asks per user per minute.
    const { allowed } = await consumeRateLimit(`lms-assistant:${ctx.user.id}`, 10, 60_000);
    if (!allowed) throw new RateLimitError();

    const body = (await req.json()) as unknown;
    const input = askSchema.parse(body);

    const apiKey = process.env.GEMINI_API_KEY;
    const prompt = [
      "You are Airborne Aviation's study assistant.",
      "Answer clearly for pilot / ground-school students.",
      input.courseTitle ? `Course: ${input.courseTitle}` : null,
      input.chapterTitle ? `Chapter: ${input.chapterTitle}` : null,
      input.topicTitle ? `Topic: ${input.topicTitle}` : null,
      input.contextText ? `Notes:\n${input.contextText}` : null,
      `Question: ${input.question}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    if (!apiKey) {
      return ok({
        answer:
          "AI assistant is not configured yet (missing GEMINI_API_KEY). Your question was received and will work once the key is set.",
        model: null,
        stub: true,
        echo: { topicId: input.topicId, question: input.question },
      });
    }

    const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";
    const unavailable = {
      answer: "The AI service is unavailable right now. Please try again in a moment.",
      model: "gemini-2.0-flash",
      stub: false,
    };
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        // Key in a header, not the URL, so it never lands in proxy/access logs.
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
        signal: AbortSignal.timeout(25_000),
      });
    } catch (fetchErr) {
      console.error("[lms-assistant] upstream request failed", (fetchErr as Error).name);
      return ok(unavailable);
    }

    if (!res.ok) {
      // Upstream error bodies can include quota/project details — log, don't return.
      console.error("[lms-assistant] upstream error", res.status, (await res.text()).slice(0, 500));
      return ok(unavailable);
    }

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const answer =
      data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ??
      "No answer generated.";

    return ok({ answer, model: "gemini-2.0-flash", stub: false });
  } catch (err) {
    return handleError(err);
  }
}
