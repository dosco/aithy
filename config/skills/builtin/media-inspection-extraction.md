---
name: Media Inspection And Extraction
description: Inspect audio/video files and perform basic local extraction, thumbnails, transcoding, and normalization with ffmpeg tools.
when_to_use: Use when the user asks about audio or video metadata, streams, codecs, durations, audio extraction, frame thumbnails, or simple local media conversion.
tools: Bash(ffmpeg:*) Bash(ffprobe:*) Bash(mediainfo:*) Bash(python3:*) Read Write
required_sandbox_capabilities: media
tags: builtin media audio video ffmpeg ffprobe mediainfo metadata extraction transcode
---

# Media Inspection And Extraction

Use local media tools for observable audio and video file work.

Commands:

```bash
mediainfo INPUT
ffprobe -hide_banner -show_format -show_streams INPUT
ffmpeg -i INPUT -vn -acodec copy output.m4a
ffmpeg -i INPUT -ss 00:00:01 -frames:v 1 thumbnail.jpg
ffmpeg -i INPUT -c:v libx264 -c:a aac output.mp4
```

Workflow:

1. Inspect metadata and streams with `mediainfo` or `ffprobe` before changing the file.
2. Choose copy-mode extraction when possible to avoid needless quality loss.
3. For thumbnails or frame grabs, record the timestamp used.
4. For transcoding or normalization, write a new output and keep the original unchanged.
5. Verify the output exists, sample its metadata, and report codec, duration, and size changes.

Limits:

- Do not claim speech transcription, speaker identification, or video understanding.
- Do not download media from the network; work on local or user-provided files.
- Do not use `yt-dlp`, Whisper, moviepy, or heavyweight media ML stacks.
