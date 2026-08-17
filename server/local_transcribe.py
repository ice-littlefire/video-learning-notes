import argparse
import json
import sys


def main():
    parser = argparse.ArgumentParser(description="Transcribe audio with faster-whisper.")
    parser.add_argument("audio_path")
    parser.add_argument("--model", default="base")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--compute-type", default="int8")
    parser.add_argument("--language", default="zh")
    args = parser.parse_args()

    try:
        from faster_whisper import WhisperModel

        model = WhisperModel(args.model, device=args.device, compute_type=args.compute_type)
        segments, info = model.transcribe(
            args.audio_path,
            language=args.language or None,
            vad_filter=True,
            beam_size=5,
        )
        output_segments = [
            {
                "from": float(segment.start),
                "to": float(segment.end),
                "content": segment.text.strip(),
            }
            for segment in segments
            if segment.text and segment.text.strip()
        ]
        print(
            json.dumps(
                {
                    "language": getattr(info, "language", None),
                    "language_probability": getattr(info, "language_probability", None),
                    "segments": output_segments,
                },
                ensure_ascii=True,
            ),
            flush=True,
        )
    except Exception as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=True), file=sys.stderr, flush=True)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
