#!/usr/bin/env python3

import argparse
import json
import sys


def main() -> int:
    parser = argparse.ArgumentParser(description="Transcribe audio with faster-whisper.")
    parser.add_argument("audio_path", help="Path to the audio file to transcribe.")
    parser.add_argument(
        "--model",
        default="base",
        help="Whisper model name to use. Defaults to 'base'.",
    )
    args = parser.parse_args()

    try:
        from faster_whisper import WhisperModel
    except Exception as exc:  # pragma: no cover - exercised via node integration
        print(
            json.dumps(
                {
                    "error": (
                        "Local transcription requires the Python package 'faster-whisper'. "
                        f"Import failed: {exc}"
                    )
                }
            )
        )
        return 1

    try:
        model = WhisperModel(args.model, device="cpu", compute_type="int8")
        segments, info = model.transcribe(
            args.audio_path,
            beam_size=3,
            vad_filter=True,
            condition_on_previous_text=False,
        )
        text = " ".join(segment.text.strip() for segment in segments if segment.text.strip()).strip()
        print(
            json.dumps(
                {
                    "text": text,
                    "language": getattr(info, "language", None),
                    "language_probability": getattr(info, "language_probability", None),
                }
            )
        )
        return 0
    except Exception as exc:  # pragma: no cover - exercised via node integration
        print(json.dumps({"error": f"Local transcription failed: {exc}"}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
