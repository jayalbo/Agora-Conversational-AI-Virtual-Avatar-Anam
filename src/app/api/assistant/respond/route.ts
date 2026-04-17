import { NextResponse } from "next/server";

type RespondPayload = {
  message: string;
  systemPrompt?: string;
};

async function generateAssistantText(message: string, systemPrompt: string) {
  const openaiApiKey = process.env.OPENAI_API_KEY;
  const openaiModel = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  if (!openaiApiKey) {
    throw new Error("Missing OPENAI_API_KEY");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: openaiModel,
      input: [
        { role: "system", content: [{ type: "input_text", text: systemPrompt }] },
        { role: "user", content: [{ type: "input_text", text: message }] }
      ]
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI request failed: ${text}`);
  }

  const payload = (await response.json()) as { output_text?: string };
  const assistantText = payload.output_text?.trim();

  if (!assistantText) {
    throw new Error("OpenAI returned an empty response");
  }

  return assistantText;
}

async function synthesizeSpeech(text: string) {
  const elevenLabsApiKey = process.env.ELEVENLABS_API_KEY;
  const elevenLabsVoiceId = process.env.ELEVENLABS_VOICE_ID;
  const elevenLabsModelId = process.env.ELEVENLABS_MODEL_ID ?? "eleven_flash_v2_5";

  if (!elevenLabsApiKey || !elevenLabsVoiceId) {
    return { audioBase64: "", mimeType: "audio/mpeg", generated: false as const };
  }

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(elevenLabsVoiceId)}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": elevenLabsApiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model_id: elevenLabsModelId,
        text,
        output_format: "mp3_44100_128"
      })
    }
  );

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`ElevenLabs request failed: ${details}`);
  }

  const audioBuffer = Buffer.from(await response.arrayBuffer());
  return {
    audioBase64: audioBuffer.toString("base64"),
    mimeType: "audio/mpeg",
    generated: true as const
  };
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as RespondPayload;
    const message = payload.message?.trim();
    const systemPrompt = payload.systemPrompt?.trim() || "You are a helpful assistant.";

    if (!message) {
      return NextResponse.json({ error: "Message is required." }, { status: 400 });
    }

    const assistantText = await generateAssistantText(message, systemPrompt);
    const speech = await synthesizeSpeech(assistantText);

    return NextResponse.json({
      assistantText,
      audioBase64: speech.audioBase64,
      audioMimeType: speech.mimeType,
      audioGenerated: speech.generated
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to generate assistant response."
      },
      { status: 500 }
    );
  }
}
