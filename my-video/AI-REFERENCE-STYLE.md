# AI Reference Video Style Replication

The local studio adds a browser UI and API without replacing the current composition until you click Apply.

## Workflow
1. Provide a reference video and your own footage, as uploads or direct HTTPS video-file URLs.
2. FFprobe reads metadata; FFmpeg samples three reference frames.
3. Groq vision generates a structured style profile; Groq Whisper transcription is attempted for small videos.
4. The app writes JSON analysis and HTML with HyperFrames timing attributes, timed segments, captions, and punch-in motion.
5. Review the result. Apply creates a timestamped backup of index.html before replacing it.

## Windows setup
From PowerShell:
```powershell
cd "$HOME\Desktop\Capstone Project\Video Editor\my-video"
Copy-Item .env.example .env
notepad .env
npm install
npm run studio
```
Add your Groq key to .env; never commit .env. Install FFmpeg and FFprobe and add their folder to PATH, then open a new PowerShell window and verify:
```powershell
ffmpeg -version
ffprobe -version
npm run check
```
Alternatively set FFMPEG_PATH and FFPROBE_PATH in .env to the full executable paths. Open http://127.0.0.1:4173.

## URL and security
Only direct HTTPS video-file URLs are supported. Social watch pages are not direct downloads; download a video you have permission to use and upload it. The server rejects private hosts, revalidates redirects, limits download size, and binds only to 127.0.0.1. Files live in uploads/, generated/, and backups/. Keep the server local.

Three sampled frames cannot reliably reveal every cut, transition, or sound effect. Review captions and timings and run npm run check plus a visual preview before publishing.

## Commands
- npm run studio — local style-analysis UI and API
- npm run check — HyperFrames validation
- npm run dev — existing HyperFrames preview
- npm run render — existing HyperFrames render
