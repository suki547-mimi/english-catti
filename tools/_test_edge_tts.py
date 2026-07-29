"""Quick edge-tts test: generate 3 test mp3s, measure timings.
US voice: en-US-AriaNeural
UK voice: en-GB-SoniaNeural
"""
import asyncio, edge_tts, os, time

OUT = r'C:\Cursorworkspace\English\data\audio_test'
os.makedirs(OUT, exist_ok=True)

TEST = [
    ("hegemony", "hegemony"),
    ("carbon neutrality", "The pursuit of carbon neutrality is a global priority."),
    ("rejuvenation", "the great rejuvenation of the Chinese nation"),
]

VOICES = {
    "US-Aria":   "en-US-AriaNeural",
    "US-Guy":    "en-US-GuyNeural",
    "UK-Sonia":  "en-GB-SoniaNeural",
    "UK-Ryan":   "en-GB-RyanNeural",
}

async def main():
    for name, text in TEST:
        for voice_name, voice_id in VOICES.items():
            t0 = time.time()
            path = os.path.join(OUT, f"{name}__{voice_name}.mp3")
            communicate = edge_tts.Communicate(text, voice_id)
            await communicate.save(path)
            dt = time.time() - t0
            size = os.path.getsize(path)
            print(f"  {name:22} {voice_name:12}  {dt:.2f}s  {size} bytes  -> {path}")

asyncio.run(main())
print("\nDone. Play some to check quality.")
