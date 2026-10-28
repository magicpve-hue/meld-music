# Third-party software

Meld is an independent application. It is not affiliated with Spotify, SoundCloud or YouTube.

The application packages Electron; its license and Chromium notices are included in each desktop distribution. Source: https://github.com/electron/electron, MIT and third-party component licenses.

The following executables are downloaded only when the user chooses “Установить движки”. They are separate processes, not bundled with Meld's source archive. Exact versions, release URLs, sizes and SHA-256 digests are pinned in `src/tool-manifest.json`.

- spotDL: https://github.com/spotDL/spotify-downloader — MIT. Source at the matching release tag; dependencies have their own licenses. Spotify metadata is used to match recordings on YouTube. This does not retrieve Spotify's encrypted audio.
- yt-dlp: https://github.com/yt-dlp/yt-dlp — Unlicense source; standalone binary distribution includes third-party components and may be GPLv3+. See the release repository's license section and its third-party notices.
- FFmpeg / FFprobe builds: https://github.com/eugeneware/ffmpeg-static — separately downloaded builds. The matching build license is downloaded as `tools/ffmpeg.LICENSE`; upstream FFmpeg source and build-source information are linked by https://github.com/eugeneware/ffmpeg-static and https://ffmpeg.org/download.html. This application does not relicense the executables.
- Deno: https://github.com/denoland/deno — MIT and third-party component notices in upstream sources.

Platform terms and availability are separate from the licenses of these tools. Open-source software does not grant rights to recordings. Meld implements no DRM decryption, paywall bypass or automatic use of browser cookies.
