// Explicit maintainer action: pins official release URLs and SHA-256 digests.
const fs = require('node:fs');
const path = require('node:path');
async function release(repo) {
  const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers: { 'User-Agent': 'Meld-build' } });
  if (!response.ok) throw new Error(`${repo}: ${response.status}`);
  return response.json();
}
(async () => {
  const [spotdl, ytdlp, ffmpeg, deno] = await Promise.all(['spotDL/spotify-downloader', 'yt-dlp/yt-dlp', 'eugeneware/ffmpeg-static', 'denoland/deno'].map(release));
  function asset(release, name, filename, archive = false) {
    const a = release.assets.find(a => a.name === name);
    if (!a?.digest?.startsWith('sha256:')) throw new Error(`Missing SHA-256: ${name}`);
    return { url: a.browser_download_url, sha256: a.digest.slice(7), filename, archive, version: release.tag_name, size: a.size };
  }
  const manifest = { generated: new Date().toISOString(), platforms: {} };
  for (const [platform, spot, yt, ff, d] of [
    ['darwin-arm64', `spotdl-${spotdl.tag_name.slice(1)}-darwin`, 'yt-dlp_macos', 'darwin-arm64', 'aarch64-apple-darwin'],
    ['win32-x64', `spotdl-${spotdl.tag_name.slice(1)}-win32.exe`, 'yt-dlp.exe', 'win32-x64', 'x86_64-pc-windows-msvc']
  ]) {
    const ext = platform.startsWith('win') ? '.exe' : '';
    manifest.platforms[platform] = {
      spotdl: asset(spotdl, spot, 'spotdl' + ext),
      ytdlp: asset(ytdlp, yt, 'yt-dlp' + ext),
      ffmpeg: asset(ffmpeg, 'ffmpeg-' + ff, 'ffmpeg' + ext),
      ffprobe: asset(ffmpeg, 'ffprobe-' + ff, 'ffprobe' + ext),
      deno: asset(deno, 'deno-' + d + '.zip', 'deno' + ext, true),
      ffmpegLicense: asset(ffmpeg, ff + '.LICENSE', 'ffmpeg.LICENSE')
    };
  }
  fs.writeFileSync(path.join(__dirname, '../src/tool-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log('Pinned tools:', spotdl.tag_name, ytdlp.tag_name, ffmpeg.tag_name, deno.tag_name);
})().catch(error => { console.error(error); process.exitCode = 1; });
