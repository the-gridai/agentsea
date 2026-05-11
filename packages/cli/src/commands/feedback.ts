import * as p from "@clack/prompts";
import pc from "picocolors";
import { POSTHOG_CAPTURE_URL, POSTHOG_PROJECT_API_KEY } from "../shared/posthog-config.js";
import { asyncTryCatch } from "../shared/result.js";
import { isInteractiveTTY } from "./shared.js";

// Public ingestion key + survey — same PostHog project as telemetry (see posthog-config.ts).
const SURVEY_ID = "019ce7ef-c3e7-0000-415b-729f190e09bc";

export async function cmdFeedback(args: string[]): Promise<void> {
  let message = args.join(" ").trim();

  if (!message) {
    if (!isInteractiveTTY()) {
      console.error(pc.red("Error: Please provide your feedback message."));
      console.error(`\nUsage: ${pc.cyan('grid-spawn feedback "your feedback here"')}`);
      process.exit(1);
    }

    const input = await p.text({
      message: "What feedback would you like to share?",
      placeholder: "Tell us what to improve...",
      validate: (val) => {
        if (!val?.trim()) {
          return "Feedback message cannot be empty";
        }
        return undefined;
      },
    });

    if (p.isCancel(input)) {
      p.outro(pc.dim("Cancelled."));
      return;
    }

    message = input.trim();
  }

  const body = {
    token: POSTHOG_PROJECT_API_KEY,
    distinct_id: "anon",
    event: "survey sent",
    properties: {
      $survey_id: SURVEY_ID,
      $survey_response: message,
      $survey_completed: true,
      source: "cli",
    },
  };

  const result = await asyncTryCatch(async () => {
    const res = await fetch(POSTHOG_CAPTURE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      throw new Error(`PostHog returned ${String(res.status)}`);
    }
  });

  if (!result.ok) {
    console.error(pc.red("Failed to send feedback. Please try again later."));
    process.exit(1);
  }

  console.log(pc.green("Thanks for your feedback!"));
}
