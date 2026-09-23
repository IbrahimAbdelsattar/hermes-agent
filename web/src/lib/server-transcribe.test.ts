// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

import { authedFetch } from "@/lib/api";
import { blobToDataUrl, transcribeAudioBlob } from "./server-transcribe";

vi.mock("@/lib/api", () => ({ authedFetch: vi.fn() }));
const mockAuthedFetch = vi.mocked(authedFetch);

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: () => Promise.resolve(body) } as unknown as Response;
}

describe("blobToDataUrl", () => {
  it("encodes a recording as a base64 data URL", async () => {
    const blob = new Blob(["hello"], { type: "audio/webm" });
    const dataUrl = await blobToDataUrl(blob);
    expect(dataUrl.startsWith("data:audio/webm;base64,")).toBe(true);
    expect(atob(dataUrl.split(",")[1] ?? "")).toBe("hello");
  });
});

describe("transcribeAudioBlob", () => {
  beforeEach(() => {
    mockAuthedFetch.mockReset();
  });

  it("posts the recording to /api/audio/transcribe and returns the server transcript", async () => {
    mockAuthedFetch.mockResolvedValue(jsonResponse({ ok: true, transcript: "actual words" }));
    const blob = new Blob(["audio-bytes"], { type: "audio/webm" });
    await expect(transcribeAudioBlob(blob, "browser draft")).resolves.toBe("actual words");

    expect(mockAuthedFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockAuthedFetch.mock.calls[0];
    expect(url).toBe("/api/audio/transcribe");
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.mime_type).toBe("audio/webm");
    expect(String(body.data_url).startsWith("data:audio/webm;base64,")).toBe(true);
  });

  it("falls back to the browser draft when the endpoint answers empty (silence)", async () => {
    mockAuthedFetch.mockResolvedValue(jsonResponse({ ok: true, transcript: "" }));
    const blob = new Blob(["audio-bytes"], { type: "audio/webm" });
    await expect(transcribeAudioBlob(blob, "browser draft")).resolves.toBe("browser draft");
  });

  it("falls back to the browser draft when the endpoint errors", async () => {
    mockAuthedFetch.mockResolvedValue(jsonResponse({ detail: "boom" }, false));
    const blob = new Blob(["audio-bytes"], { type: "audio/webm" });
    await expect(transcribeAudioBlob(blob, "browser draft")).resolves.toBe("browser draft");
  });

  it("falls back to the browser draft when the request itself throws", async () => {
    mockAuthedFetch.mockRejectedValue(new Error("network down"));
    const blob = new Blob(["audio-bytes"], { type: "audio/webm" });
    await expect(transcribeAudioBlob(blob, "browser draft")).rejects.toThrow("network down");
  });

  it("never calls the endpoint for an empty recording", async () => {
    const blob = new Blob([], { type: "audio/webm" });
    await expect(transcribeAudioBlob(blob, "browser draft")).resolves.toBe("browser draft");
    expect(mockAuthedFetch).not.toHaveBeenCalled();
  });
});
