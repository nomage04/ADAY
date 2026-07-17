const PPT_CONTEXT_COMPRESS_SYSTEM = `You compress context for ppt-deck-planner.

Return one JSON object only:
{
  "summary": "compact synthesis of the useful context",
  "facts": ["specific facts, names, numbers, dates to preserve"],
  "constraints": ["hard user constraints and explicit requirements"],
  "decisions": ["brief decisions already validated or assumed"],
  "omissions": ["non-essential details intentionally omitted"],
  "recent_messages": [{"role":"user|assistant|system","content":"short exact or near-exact recent message"}],
  "user_photos": null
}

Rules:
- Preserve exact topic, slide_count, include_speaker_notes, unique_layouts_per_deck, validated brief, explicit user constraints, recent requests, layout catalog, icon catalog, logo catalog, and schemas.
- Compress old chat history, long notes, redundant explanations, and verbose photo descriptions.
- Do not invent facts or constraints.
- Keep the result directly usable by ppt-deck-planner.
- No prose outside the JSON.`;
